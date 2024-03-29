import {
  Controller,
  Get,
  Logger,
  Next,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { OidcProviderService } from '../oidc-provider.service';
import * as assert from 'assert';
import { BaseGrantableEntity } from '../entities/BaseGrantableEntity';
import { AccountService } from '../account/account.service';

@Controller('interaction')
export class InteractionsController {
  private _logger: Logger;

  constructor(
    private oidcService: OidcProviderService,
    private accountService: AccountService,
  ) {
    this._logger = new Logger('InteractionsController');
  }

  @Get(':uid')
  async renderInteraction(
    @Req() request: Request,
    @Res() response: Response,
    @Next() next: NextFunction,
  ) {
    try {
      const details = await this.oidcService.oidc.interactionDetails(
        request,
        response,
      );
      this._logger.log(details);
      console.log({ details });
      const { uid, prompt, params } = details;

      const client = await this.oidcService.oidc.Client.find(
        params.client_id as string,
      );

      if (prompt.name === 'login') {
        return response.render('login', {
          client,
          uid,
          details: prompt.details,
          params,
          title: 'Sign-in',
          flash: undefined,
        });
      }

      return response.render('interaction', {
        client,
        uid,
        details: prompt.details,
        params,
        title: 'Authorize',
      });
    } catch (err) {
      return next(err);
    }
  }

  @Post(':uid/login')
  async login(
    @Req() req: Request,
    @Res() res: Response,
    @Next() next: NextFunction,
  ) {
    try {
      const { uid, prompt, params } =
        await this.oidcService.oidc.interactionDetails(req, res);

      console.log({ uid, prompt, params });
      assert.strictEqual(prompt.name, 'login');
      const client = await this.oidcService.oidc.Client.find(
        params.client_id as string,
      );

      const accountId = await this.accountService.authenticate(
        req.body.email,
        req.body.password,
      );

      if (!accountId) {
        res.render('login', {
          client,
          uid,
          details: prompt.details,
          params: {
            ...params,
            login_hint: req.body.email,
          },
          title: 'Sign-in',
          flash: 'Invalid email or password.',
        });
        return;
      }

      const result = {
        login: { accountId },
      };

      await this.oidcService.oidc.interactionFinished(req, res, result, {
        mergeWithLastSubmission: false,
      });
    } catch (err) {
      next(err);
    }
  }

  @Get(':uid/signup')
  async signupRender(
    @Req() req: Request,
    @Res() res: Response,
    @Next() next: NextFunction,
  ) {
    try {
      const { uid, prompt, params } =
        await this.oidcService.oidc.interactionDetails(req, res);

      const client = await this.oidcService.oidc.Client.find(
        params.client_id as string,
      );

      res.render('signup', {
        client,
        uid,
        details: prompt.details,
        params: {
          ...params,
          login_hint: req.body.email,
        },
        title: 'Sign-up',
        flash: 'Create Droplinked Account',
      });
    } catch (err) {
      next(err);
    }
  }

  @Post(':uid/signup')
  async signup(
    @Req() req: Request,
    @Res() res: Response,
    @Next() next: NextFunction,
  ) {
    try {
      const { uid, prompt, params } =
        await this.oidcService.oidc.interactionDetails(req, res);

      const client = await this.oidcService.oidc.Client.find(
        params.client_id as string,
      );

      const accountId = await this.accountService.signup(
        req.body.name,
        req.body.email,
        req.body.password,
        client.clientId
      );

      const result = {
        login: { accountId },
      };

      await this.oidcService.oidc.interactionFinished(req, res, result, {
        mergeWithLastSubmission: false,
      });
    } catch (err) {
      next(err);
    }
  }

  @Post(':uid/confirm')
  async confirmInteraction(
    @Req() req: Request,
    @Res() res: Response,
    @Next() next: NextFunction,
  ) {
    try {
      const interactionDetails = await this.oidcService.oidc.interactionDetails(
        req,
        res,
      );
      const {
        prompt: { name, details },
        params,
        session: { accountId },
      } = interactionDetails;
      assert.strictEqual(name, 'consent');

      let { grantId } = interactionDetails;
      let grant;

      if (grantId) {
        // we'll be modifying existing grant in existing session
        grant = await this.oidcService.oidc.Grant.find(grantId);
      } else {
        // we're establishing a new grant
        grant = new this.oidcService.oidc.Grant({
          accountId,
          clientId: params.client_id as string,
        });
      }

      console.log({ grant });
      if (details.missingOIDCScope) {
        grant.addOIDCScope((details.missingOIDCScope as string[]).join(' '));
        // use grant.rejectOIDCScope to reject a subset or the whole thing
      }
      if (details.missingOIDCClaims) {
        grant.addOIDCClaims(details.missingOIDCClaims as string[]);
        // use grant.rejectOIDCClaims to reject a subset or the whole thing
      }
      if (details.missingResourceScopes) {
        for (const [indicator, scopes] of Object.entries(
          details.missingResourceScopes,
        )) {
          grant.addResourceScope(indicator, scopes.join(' '));
          // use grant.rejectResourceScope to reject a subset or the whole thing
        }
      }

      grantId = await grant.save();

      const consent = {} as BaseGrantableEntity;
      if (!interactionDetails.grantId) {
        // we don't have to pass grantId to consent, we're just modifying existing one
        consent.grantId = grantId;
      }

      const result = { consent };
      await this.oidcService.oidc.interactionFinished(req, res, result, {
        mergeWithLastSubmission: true,
      });
    } catch (err) {
      next(err);
    }
  }

  @Get(':uid/abort')
  async abortInteraction(
    @Req() req: Request,
    @Res() res: Response,
    @Next() next: NextFunction,
  ) {
    try {
      const result = {
        error: 'access_denied',
        error_description: 'End-User aborted interaction',
      };
      await this.oidcService.oidc.interactionFinished(req, res, result, {
        mergeWithLastSubmission: false,
      });
    } catch (err) {
      next(err);
    }
  }
}

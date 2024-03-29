import {
  Body,
  Controller,
  HttpCode,
  Logger,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { UserService } from './user/user.service';
import { AuthorizeDto } from './oauth.dto';
import { Request, Response } from 'express';
import { OauthServerService } from './oauth-server.service';
import {
  Request as OAuth2Request,
  Response as OAuth2Response,
} from 'oauth2-server';
import { ApiBody, ApiConsumes, ApiOperation } from '@nestjs/swagger';

@Controller('oauth')
export class OauthController {
  constructor(
    private userService: UserService,
    private oAuthServer: OauthServerService,
  ) {}

  @Post('authorize')
  @HttpCode(302)
  @ApiConsumes('application/json')
  @ApiOperation({
    description: 'Authorize a client to access user data',
    summary: 'Authorize',
    tags: ['OAuth Authorize'],
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        client_id: { type: 'string' },
        redirect_uri: { type: 'string' },
        grant_type: { type: 'string' },
        response_type: { type: 'string' },
        userEmail: { type: 'string' },
        userPassword: { type: 'string' },
      },
    },
  })
  async authorize(
    @Body() authorizeDto: AuthorizeDto,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    const user = await this.userService.authenticate(
      authorizeDto.userEmail,
      authorizeDto.userPassword,
    );

    if (!user) throw new UnauthorizedException('Please Sign-up first');
    return this.oAuthServer.server
      .authorize(new OAuth2Request(request), new OAuth2Response(response), {
        authenticateHandler: {
          handle() {
            return user;
          },
        },
      })
      .then((code) => {
        console.log("req url", request.url)
        const redirectUrl = new URL(authorizeDto.redirect_uri);
        redirectUrl.searchParams.append('code', code.authorizationCode);
        response.redirect(redirectUrl.toString());
      })
      .catch((err) => {
        throw new UnauthorizedException(`${err}`);
      });
  }

  @Post('token')
  async token(@Req() request: Request, @Res() response: Response) {
    return this.oAuthServer.server
      .token(new OAuth2Request(request), new OAuth2Response(response), {
        requireClientAuthentication: {
          authorization_code: false,
        },
      })
      .then((token) => {
        response.send(token);
      });
  }
}

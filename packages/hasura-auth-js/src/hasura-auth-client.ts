import jwt_decode from 'jwt-decode'
import { interpret } from 'xstate'

import {
  AuthClient,
  AuthInterpreter,
  changeEmailPromise,
  changePasswordPromise,
  createChangeEmailMachine,
  createChangePasswordMachine,
  createResetPasswordMachine,
  createSendVerificationEmailMachine,
  EMAIL_NEEDS_VERIFICATION,
  encodeQueryParameters,
  ErrorPayload,
  INVALID_REFRESH_TOKEN,
  JWTClaims,
  JWTHasuraClaims,
  NO_REFRESH_TOKEN,
  resetPasswordPromise,
  rewriteRedirectTo,
  sendVerificationEmailPromise,
  signInAnonymousPromise,
  signInEmailPasswordlessPromise,
  signInEmailPasswordPromise,
  signInMfaTotpPromise,
  signInSmsPasswordlessOtpPromise,
  signInSmsPasswordlessPromise,
  signOutPromise,
  signUpEmailPasswordPromise,
  TOKEN_REFRESHER_RUNNING_ERROR
} from '@nhost/core'

import { getAuthenticationResult, getSession, isBrowser } from './utils/helpers'
import {
  ApiChangeEmailResponse,
  ApiChangePasswordResponse,
  ApiDeanonymizeResponse,
  ApiResetPasswordResponse,
  ApiSendVerificationEmailResponse,
  ApiSignOutResponse,
  AuthChangedFunction,
  ChangeEmailParams,
  ChangePasswordParams,
  DeanonymizeParams,
  NhostAuthConstructorParams,
  OnTokenChangedFunction,
  ResetPasswordParams,
  SendVerificationEmailParams,
  Session,
  SignInParams,
  SignInResponse,
  SignUpParams,
  SignUpResponse
} from './utils/types'

/**
 * @alias Auth
 */
export class HasuraAuthClient {
  private _client: AuthClient
  readonly url: string
  constructor({
    url,
    autoRefreshToken = true,
    autoSignIn = true,
    autoLogin,
    clientStorage,
    clientStorageType,
    clientStorageGetter,
    clientStorageSetter,
    refreshIntervalTime,
    start = true
  }: NhostAuthConstructorParams) {
    this.url = url
    this._client = new AuthClient({
      backendUrl: url,
      clientUrl: (typeof window !== 'undefined' && window.location?.origin) || '',
      autoRefreshToken,
      autoSignIn: typeof autoLogin === 'boolean' ? autoLogin : autoSignIn,
      start,
      clientStorage,
      clientStorageType,
      clientStorageGetter,
      clientStorageSetter,
      refreshIntervalTime
    })
  }

  /**
   * Use `nhost.auth.signUp` to sign up a user using email and password. If you want to sign up a user using passwordless email (Magic Link), SMS, or an OAuth provider, use the `signIn` function instead.
   *
   * @example
   * ```ts
   * nhost.auth.signUp({
   *   email: 'joe@example.com',
   *   password: 'secret-password'
   * })
   * ```
   *
   * @docs https://docs.nhost.io/reference/javascript/auth/sign-up
   */
  async signUp({ email, password, options }: SignUpParams): Promise<SignUpResponse> {
    const interpreter = await this.waitUntilReady()
    return getAuthenticationResult(
      await signUpEmailPasswordPromise(interpreter, email, password, options)
    )
  }

  /**
   * Use `nhost.auth.signIn` to sign in a user using email and password, passwordless (email or sms) or an external provider. `signIn` can be used to sign in a user in various ways depending on the parameters.
   *
   * @example
   * ### Sign in a user using email and password
   * ```ts
   * nhost.auth.signIn({
   *   email: 'joe@example.com',
   *   password: 'secret-password'
   * })
   * ```
   *
   * @example
   * ### Sign in a user using an OAuth provider (e.g: Google or Facebook)
   * ```ts
   * nhost.auth.signIn({ provider: 'google' })
   * ```
   *
   * @example
   * ### Sign in a user using passwordless email (Magic Link)
   * ```ts
   * nhost.auth.signIn({ email: 'joe@example.com' })
   * ```
   *
   * @example
   * ### Sign in a user using passwordless SMS
   * ```ts
   * // [step 1/2] Passwordless sign in using SMS
   * nhost.auth.signIn({ phoneNumber: '001122334455' })
   *
   * // [step 2/2] Finish passwordless sign in using SMS (OTP)
   * nhost.auth.signIn({ phoneNumber: '001122334455', otp: '123456' })
   * ```
   *
   * @docs https://docs.nhost.io/reference/javascript/auth/sign-in
   */
  async signIn(params: SignInParams): Promise<SignInResponse> {
    const interpreter = await this.waitUntilReady()

    // * Sign in with a social provider (OAuth)
    if ('provider' in params) {
      const { provider, options } = params
      const providerUrl = encodeQueryParameters(
        `${this._client.backendUrl}/signin/provider/${provider}`,
        rewriteRedirectTo(this._client.clientUrl, options as any)
      )
      if (isBrowser()) {
        window.location.href = providerUrl
      }
      return { providerUrl, provider, session: null, mfa: null, error: null }
    }

    // * Email + password
    if ('email' in params && 'password' in params) {
      const res = await signInEmailPasswordPromise(interpreter, params.email, params.password)
      if (res.needsEmailVerification) {
        return { session: null, mfa: null, error: EMAIL_NEEDS_VERIFICATION }
      }
      if (res.needsMfaOtp) {
        return {
          session: null,
          mfa: res.mfa,
          error: null
        }
      }
      return { ...getAuthenticationResult(res), mfa: null }
    }

    // * Passwordless Email (magic link)
    if ('email' in params) {
      const { error } = await signInEmailPasswordlessPromise(interpreter, params.email)
      return {
        session: null,
        mfa: null,
        error
      }
    }

    // * Passwordless SMS: [step 2/2] sign in using SMS OTP
    if ('phoneNumber' in params && 'otp' in params) {
      const res = await signInSmsPasswordlessOtpPromise(interpreter, params.phoneNumber, params.otp)
      return { ...getAuthenticationResult(res), mfa: null }
    }

    // * Passwordless SMS: [step 1/2] sign in using SMS
    if ('phoneNumber' in params) {
      const { error } = await signInSmsPasswordlessPromise(
        interpreter,
        params.phoneNumber,
        params.options
      )
      return { error, mfa: null, session: null }
    }

    // * Email + password MFA TOTP
    if ('otp' in params) {
      const res = await signInMfaTotpPromise(interpreter, params.otp, params.ticket)
      return { ...getAuthenticationResult(res), mfa: null }
    }
    // * Anonymous sign-in
    const anonymousResult = await signInAnonymousPromise(interpreter)
    return { ...getAuthenticationResult(anonymousResult), mfa: null }
  }

  /**
   * Use `nhost.auth.signOut` to sign out the user.
   *
   * @example
   * ### Sign out the user from current device
   * ```ts
   * nhost.auth.signOut()
   * ```
   *
   * @example
   * ### Sign out the user from all devices
   * ```ts
   * nhost.auth.signOut({all: true})
   * ```
   *
   * @docs https://docs.nhost.io/reference/javascript/auth/sign-out
   */
  async signOut(params?: { all?: boolean }): Promise<ApiSignOutResponse> {
    const interpreter = await this.waitUntilReady()
    const { error } = await signOutPromise(interpreter, params?.all)
    return { error }
  }

  /**
   * Use `nhost.auth.resetPassword` to reset the password for a user. This will send a reset-password link in an email to the user. When the user clicks the reset-password link the user is automatically signed-in. Once signed-in, the user can change their password using `nhost.auth.changePassword()`.
   *
   * @example
   * ```ts
   * nhost.auth.resetPassword({email: 'joe@example.com' })
   * ```
   *
   * @docs https://docs.nhost.io/reference/javascript/auth/reset-password
   */
  async resetPassword({ email, options }: ResetPasswordParams): Promise<ApiResetPasswordResponse> {
    const service = interpret(createResetPasswordMachine(this._client)).start()
    const { error } = await resetPasswordPromise(service, email, options)
    return { error }
  }

  /**
   * Use `nhost.auth.changePassword` to change the password for the user. The old password is not needed.
   *
   * @example
   * ```ts
   * nhost.auth.changePassword({ newPassword: 'new-secret-password' })
   * ```
   *
   * @docs https://docs.nhost.io/reference/javascript/auth/change-password
   */
  async changePassword({ newPassword }: ChangePasswordParams): Promise<ApiChangePasswordResponse> {
    const service = interpret(createChangePasswordMachine(this._client)).start()
    const { error } = await changePasswordPromise(service, newPassword)
    return { error }
  }

  /**
   * Use `nhost.auth.sendVerificationEmail` to send a verification email to the specified email. The email contains a verification-email link. When the user clicks the verification-email link their email is verified.
   *
   * @example
   * ```ts
   * nhost.auth.sendVerificationEmail({ email: 'joe@example.com' })
   * ```
   *
   * @docs https://docs.nhost.io/reference/javascript/auth/send-verification-email
   */
  async sendVerificationEmail({
    email,
    options
  }: SendVerificationEmailParams): Promise<ApiSendVerificationEmailResponse> {
    const service = interpret(createSendVerificationEmailMachine(this._client)).start()
    const { error } = await sendVerificationEmailPromise(service, email, options)
    return { error }
  }

  /**
   * Use `nhost.auth.changeEmail` to change a user's email. This will send a confirm-email-change link in an email to the new email. Once the user clicks on the confirm-email-change link the email will be change to the new email.
   *
   * @example
   * ```ts
   * nhost.auth.changeEmail({ newEmail: 'doe@example.com' })
   * ```
   *
   * @docs https://docs.nhost.io/reference/javascript/auth/change-email
   */
  async changeEmail({ newEmail, options }: ChangeEmailParams): Promise<ApiChangeEmailResponse> {
    const service = interpret(createChangeEmailMachine(this._client)).start()
    const { error } = await changeEmailPromise(service, newEmail, options)
    return { error }
  }

  /**
   * Use `nhost.auth.deanonymize` to deanonymize a user.
   *
   * @example
   * ```ts
   * nhost.auth.deanonymize({signInMethod: 'email-password', email: 'joe@example.com' })
   * ```
   *
   * @docs https://docs.nhost.io/reference/javascript/auth/deanonymize
   */
  async deanonymize(params: DeanonymizeParams): Promise<ApiDeanonymizeResponse> {
    const interpreter = await this.waitUntilReady()
    if (params.signInMethod === 'passwordless') {
      if (params.connection === 'email') {
        const { error } = await signInEmailPasswordlessPromise(
          interpreter,
          params.email,
          params.options
        )
        return { error }
      }
      if (params.connection === 'sms') {
        const { error } = await signInSmsPasswordlessPromise(
          interpreter,
          params.phoneNumber,
          params.options
        )
        return { error }
      }
    }
    if (params.signInMethod === 'email-password') {
      const { error } = await signUpEmailPasswordPromise(
        interpreter,
        params.email,
        params.password,
        params.options
      )
      return { error }
    }
    throw Error(`Unknown deanonymization method`)
  }

  /**
   * Use `nhost.auth.onTokenChanged` to add a custom function that runs every time the access or refresh token is changed.
   *
   *
   * @example
   * ```ts
   * nhost.auth.onTokenChanged(() => console.log('The access and refresh token has changed'));
   * ```
   *
   * @docs https://docs.nhost.io/reference/javascript/auth/on-token-changed
   */
  onTokenChanged(fn: OnTokenChangedFunction): Function {
    const listen = (interpreter: AuthInterpreter) =>
      interpreter.onTransition(({ event, context }) => {
        if (event.type === 'TOKEN_CHANGED') {
          fn(getSession(context))
        }
      })

    if (this._client.interpreter) {
      const subscription = listen(this._client.interpreter)
      return () => subscription.stop()
    } else {
      this._client.onStart((client) => {
        listen(client.interpreter as AuthInterpreter)
      })
      return () => {
        console.log(
          'onTokenChanged was added before the interpreter started. Cannot unsubscribe listener.'
        )
      }
    }
  }

  /**
   * Use `nhost.auth.onAuthStateChanged` to add a custom function that runs every time the authentication status of the user changes. E.g. add a custom function that runs every time the authentication status changes from signed-in to signed-out.
   *
   * @example
   * ```ts
   * nhost.auth.onAuthStateChanged((event, session) => {
   *   console.log(`The auth state has changed. State is now ${event} with session: ${session}`)
   * });
   * ```
   *
   * @docs https://docs.nhost.io/reference/javascript/auth/on-auth-state-changed
   */
  onAuthStateChanged(fn: AuthChangedFunction): Function {
    const listen = (interpreter: AuthInterpreter) =>
      interpreter.onTransition(({ event, context }) => {
        if (event.type === 'SIGNED_IN' || event.type === 'SIGNED_OUT') {
          fn(event.type, getSession(context))
        }
      })
    if (this._client.interpreter) {
      const subscription = listen(this._client.interpreter)
      return () => subscription.stop()
    } else {
      this._client.onStart((client) => {
        listen(client.interpreter as AuthInterpreter)
      })
      return () => {
        console.log(
          'onAuthStateChanged was added before the interpreter started. Cannot unsubscribe listener.'
        )
      }
    }
  }

  /**
   * Use `nhost.auth.isAuthenticated` to check if the user is authenticated or not.
   *
   * Note: `nhost.auth.isAuthenticated()` can return `false` for two reasons:
   * 1. The user is not authenticated
   * 2. The user is not authenticated but _might_ be authenticated soon (loading) because there is a network request in transit.
   *
   * Use `nhost.auth.getAuthenticationStatus` to get both authentication and loading status.
   *
   * @example
   * ```ts
   * const isAuthenticated = nhost.auth.isAuthenticated();
   *
   * if (isAuthenticated) {
   *   console.log('User is authenticated');
   * }
   * ```
   *
   * @docs https://docs.nhost.io/reference/javascript/auth/is-authenticated
   */
  isAuthenticated(): boolean {
    return !!this._client.interpreter?.state.matches({ authentication: 'signedIn' })
  }

  /**
   * Use `nhost.auth.isAuthenticatedAsync` to wait (await) for any internal authentication network requests to finish and then return the authentication status.
   *
   * @example
   * ```ts
   * const isAuthenticated  = await nhost.auth.isAuthenticatedAsync();
   *
   * if (isAuthenticated) {
   *   console.log('User is authenticated');
   * }
   * ```
   *
   * @docs https://docs.nhost.io/reference/javascript/auth/is-authenticated-async
   */
  async isAuthenticatedAsync(): Promise<boolean> {
    const interpreter = await this.waitUntilReady()
    return interpreter.state.matches({ authentication: 'signedIn' })
  }

  /**
   * Use `nhost.auth.getAuthenticationStatus` to get the authentication status of the user.
   *
   * If `isLoading` is `true`, the client doesn't know whether the user is authenticated yet or not
   * because some internal authentication network requests have not been resolved yet.
   *
   * @example
   * ```ts
   * const { isAuthenticated, isLoading } = nhost.auth.getAuthenticationStatus();
   *
   * if (isLoading) {
   *   console.log('Loading...')
   * }
   *
   * if (isAuthenticated) {
   *   console.log('User is authenticated');
   * }
   * ```
   *
   * @docs https://docs.nhost.io/reference/javascript/auth/get-authentication-status
   */
  getAuthenticationStatus(): {
    isAuthenticated: boolean
    isLoading: boolean
  } {
    if (!this.isReady()) {
      return { isAuthenticated: false, isLoading: true }
    }
    return { isAuthenticated: this.isAuthenticated(), isLoading: false }
  }

  /**
   * @internal
   * @deprecated Use `nhost.auth.getAccessToken()` instead.
   * @docs https://docs.nhost.io/reference/javascript/auth/get-access-token
   */

  getJWTToken(): string | undefined {
    return this.getAccessToken()
  }

  /**
   * Use `nhost.auth.getAccessToken` to get the access token of the user.
   *
   * @example
   * ```ts
   * const accessToken = nhost.auth.getAccessToken();
   * ```
   *
   * @docs https://docs.nhost.io/reference/javascript/auth/get-access-token
   */
  getAccessToken(): string | undefined {
    return this._client.interpreter?.state.context.accessToken.value ?? undefined
  }

  /**
   * Use `nhost.auth.getDecodedAccessToken` to get the decoded access token of the user.
   *
   * @example
   * ```ts
   * const decodedAccessToken = nhost.auth.getDecodedAccessToken();
   * ```
   *
   * @see {@link https://hasura.io/docs/latest/graphql/core/auth/authentication/jwt/| Hasura documentation}
   * @docs https://docs.nhost.io/reference/javascript/auth/get-decoded-access-token
   */
  public getDecodedAccessToken(): JWTClaims | null {
    const jwt = this.getAccessToken()
    if (!jwt) return null
    return jwt_decode<JWTClaims>(jwt)
  }

  /**
   * Use `nhost.auth.getHasuraClaims` to get the Hasura claims of the user.
   *
   * @example
   * ```ts
   * const hasuraClaims = nhost.auth.getHasuraClaims();
   * ```
   *
   * @see {@link https://hasura.io/docs/latest/graphql/core/auth/authentication/jwt/| Hasura documentation}
   * @docs https://docs.nhost.io/reference/javascript/auth/get-hasura-claims
   */
  public getHasuraClaims(): JWTHasuraClaims | null {
    return this.getDecodedAccessToken()?.['https://hasura.io/jwt/claims'] || null
  }

  /**
   * Use `nhost.auth.getHasuraClaim` to get the value of a specific Hasura claim of the user.
   *
   * @example
   * ```ts
   * // if `x-hasura-company-id` exists as a custom claim
   * const companyId = nhost.auth.getHsauraClaim('company-id')
   * ```
   *
   * @param name Name of the variable. You don't have to specify `x-hasura-`.
   *
   * @see {@link https://hasura.io/docs/latest/graphql/core/auth/authentication/jwt/| Hasura documentation}
   * @docs https://docs.nhost.io/reference/javascript/auth/get-hasura-claim
   */
  public getHasuraClaim(name: string): string | string[] | null {
    return (
      this.getHasuraClaims()?.[name.startsWith('x-hasura-') ? name : `x-hasura-${name}`] || null
    )
  }

  /**
   *
   * Use `nhost.auth.refreshSession` to refresh the session with either the current internal refresh token or an external refresh token.
   *
   * Note: The Nhost client automatically refreshes the session when the user is authenticated but `nhost.auth.refreshSession` can be useful in some special cases.
   *
   * @example
   * ```ts
   * // Refresh the session with the the current internal refresh token.
   * nhost.auth.refreshToken();
   *
   * // Refresh the session with an external refresh token.
   * nhost.auth.refreshToken(refreshToken);
   * ```
   *
   * @docs https://docs.nhost.io/reference/javascript/auth/refresh-session
   */
  async refreshSession(refreshToken?: string): Promise<{
    session: Session | null
    error: ErrorPayload | null
  }> {
    try {
      const interpreter = await this.waitUntilReady()
      return new Promise((resolve) => {
        const token = refreshToken || interpreter.state.context.refreshToken.value
        if (!token) {
          return resolve({ session: null, error: NO_REFRESH_TOKEN })
        }
        const { changed } = interpreter.send('TRY_TOKEN', { token })
        if (!changed) {
          return resolve({ session: null, error: TOKEN_REFRESHER_RUNNING_ERROR })
        }
        interpreter.onTransition((state) => {
          if (state.matches({ token: { idle: 'error' } })) {
            resolve({
              session: null,
              // * TODO get the error from xstate once it is implemented
              error: INVALID_REFRESH_TOKEN
            })
          } else if (state.event.type === 'TOKEN_CHANGED') {
            resolve({ session: getSession(state.context), error: null })
          }
        })
      })
    } catch (error: any) {
      // TODO return error in the correct format
      return { session: null, error: error.message }
    }
  }

  /**
   *
   * Use `nhost.auth.getSession()` to get the session of the user.
   *
   * @example
   * ```ts
   * const session = nhost.auth.getSession();
   * ```
   *
   * @docs https://docs.nhost.io/reference/javascript/auth/get-session
   */
  getSession() {
    return getSession(this._client.interpreter?.state?.context)
  }

  /**
   *
   * Use `nhost.auth.getUser()` to get the signed-in user.
   *
   * @example
   * ```ts
   * const user = nhost.auth.getUser();
   * ```
   *
   * @docs https://docs.nhost.io/reference/javascript/auth/get-user
   */
  getUser() {
    return this._client.interpreter?.state?.context?.user || null
  }

  /**
   * Make sure the state machine is set, and wait for it to be ready
   * @returns
   */
  private waitUntilReady(): Promise<AuthInterpreter> {
    const TIMEOUT_IN_SECONS = 15
    const interpreter = this._client.interpreter
    if (!interpreter) {
      throw Error('Auth interpreter not set')
    }
    if (!interpreter.state.hasTag('loading')) {
      return Promise.resolve(interpreter)
    }
    return new Promise((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> = setTimeout(
        () => reject(`The state machine is not yet ready after ${TIMEOUT_IN_SECONS} seconds.`),
        TIMEOUT_IN_SECONS * 1_000
      )
      interpreter.onTransition((state) => {
        if (!state.hasTag('loading')) {
          clearTimeout(timer)
          return resolve(interpreter)
        }
      })
    })
  }

  private isReady() {
    return !this._client.interpreter?.state?.hasTag('loading')
  }

  get client() {
    return this._client
  }
}

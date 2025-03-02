---
title: 'Email Templates'
sidebar_position: 4
---

Nhost Auth sends out transactional emails as part of the authentication service. These emails can be modified using email templates.

The following email templates are available:

- **email-verify** - Verify email address
- **email-confirm-change** - Confirm email change to a new email address.
- **signin-passwordless** - Magic Link
- **password-reset** - Reset password

Changing email templates is only available for apps on the [Pro and Enterprise plan](https://nhost.io/pricing).

## Update Email Templates

Your app must be connected to a GitHub repository using the [GitHub Integration](/platform/github-integration) to be able to change the email templates.

Email templates are automatically deployed during a deployment, just like database migrations, Hasura metadata, and Serverless Functions.

## File Structure

Emails are located in the `nhost/` folder like this:

The email templates should be provided as body.html and subject.txt files in this predefined folder structure.

**Example:** Email templates for `en` (English) and `es` (Spanish):

```txt
my-nhost-app/
└── nhost/
    ├── config.yaml
    ├── emails/
    │   ├── en/
    │   │   ├── email-verify/
    │   │   │   ├── subject.txt
    │   │   │   └── body.html
    │   │   ├── email-confirm-change/
    │   │   │   ├── subject.txt
    │   │   │   └── body.html
    │   │   ├── signin-passwordless/
    │   │   │   ├── subject.txt
    │   │   │   └── body.html
    │   │   └── password-reset/
    │   │       ├── subject.txt
    │   │       └── body.html
    │   └── es/
    │       ├── email-verify/
    │       │   ├── subject.txt
    │       │   └── body.html
    │       ├── email-confirm-change/
    │       │   ├── subject.txt
    │       │   └── body.html
    │       ├── signin-passwordless/
    │       │   ├── subject.txt
    │       │   └── body.html
    │       └── password-reset/
    │           ├── subject.txt
    │           └── body.html
    ├── migrations/
    ├── metadata/
    └── seeds
```

As you see, the format is:

```
nhost/emails/{two-letter-language-code}/{email-template}/[subject.txt, body.html]
```

Default templates for English (`en`) and French (`fr`) are automatically generated when the app is initialized with the [CLI](/platform/cli).

## Languages

The user's language is what decides what template to send. The user's language is stored in the `auth.users` table in the `locale` column. This `locale` column contains a two-letter language code in [ISO 639-1](https://en.wikipedia.org/wiki/List_of_ISO_639-1_codes) format.

This value is `en` by default for new users.

## Variables

The following variables are available to use in the email templates:

| Variable    | Description                                                                                                                        |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| link        | The full URL to the target of the transaction. This should be used in the main call to action. This is available in all templates. |
| serverUrl   | URL of the authentication server                                                                                                   |
| clientUrl   | URL to your frontend app                                                                                                           |
| redirectTo  | URL where the user will be redirected to after clicking the link and finishing the action of the email                             |
| ticket      | Ticket that is used to authorize the link request                                                                                  |
| displayName | The display name of the user.                                                                                                      |
| email       | The email of the user.                                                                                                             |
| locale      | Locale of the user as a two-letter language code. E.g. "en".                                                                       |

Use variables like this: `${displayName}` in the email templates.

**Example:** A email template to verify users' emails:

```html title="nhost/emails/en/email-verify/body.html"
<h2>Verify You Email</h2>

<p>Hi, ${displayName}! Please click the link to verify your email:</p>

<p>
  <a href="${link}">Verify Email</a>
</p>
```

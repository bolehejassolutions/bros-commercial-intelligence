# Meta Developer connection checkpoint — 9 October 2026 (Malaysia)

The existing `bolehejassolutions/bros-commercial-intelligence` project is the integration target. This checkpoint describes local preparation, not a deployed or authenticated provider connection. Do not create another Meta Developer app.

## Current evidence

- Expected business portfolio: **Rasydan Mokhtar**, `2091328444802994`.
- Fixed ad account: **BOLEHEJAS SOLUTIONS Ads**, `act_1997776120879476`, MYR / Asia/Kuala_Lumpur.
- Vercel project: `prj_kawa3Vo7voUzAFdSfR8DWbHXy8Nw`, protected by SSO on all deployments.
- Vercel environment metadata inspected during this continuation: `META_OPERATOR_PORTFOLIO_CAP_MYR=100` exists for production, preview and development. No Meta app ID, app secret, advertising token or write-enable flag was found. Secrets were not requested in chat or retrieved.
- Existing app selected from authenticated provider evidence: **BROS Commercial Intelligence**, `1315572270590189`. The owner authorized its portfolio request; Meta confirmed that the request was automatically approved because the user administers the app. Final portfolio refresh verified the app row, **Owned by: Rasydan Mokhtar**, and the user's full access. No new app was created. The local source requires this exact app ID in private configuration, and supplies no implicit default.
- App use-case permissions `ads_read`, `ads_management` and `business_management` were shown **Ready for testing**, with zero calls. Marketing API Access Tier showed **Limited access**. The app was unpublished/in development. These screens do not establish an issued server credential or live API acceptance.
- The creation screenshot shows a new-device/location security verification prompt and a selected business/use case. That screenshot does not establish successful creation, completion of the security challenge, granted permissions or an issued server credential.
- The user completed Meta's required non-discrimination policy acceptance personally. A new existing system user, **AKU**, `61595172873577`, was subsequently visible with Admin status and no assigned assets; the operator did not create it or alter its role.
- The user explicitly authorized assigning **View performance** on account `1997776120879476` and **Develop app** on app `1315572270590189` to AKU, issuing a 60-day `ads_read`-only token, and transferring that token and this app's secret directly into BCI's Vercel Production secret store. This authorization excludes `ads_management`, the write-enable flag, activation and spending changes.
- After the approved **Assign assets** submission, Meta redirected to account recovery at `https://www.facebook.com/checkpoint/828281030927956/`. The page states the account was locked on **8 October 2026** because it may have been hacked and requires review of login information. **Stop for the user to complete recovery and any security challenge personally.** The submitted AKU assignments are **UNVERIFIED**; re-read them after recovery before any retry. No token was issued or app secret retrieved, and no Vercel configuration changed during this continuation.

## Prepared server contract

`GET /api/operator/meta/connection?mode=read` (or `mode=write`) requires an enrolled BCI administrator. It accepts no client-supplied secrets, tokens, account IDs or app IDs. It returns only fixed status/reason codes, expected identity, check completion and expiry timestamps; no provider payload or credential is returned.

The server requires private `META_APP_ID=1315572270590189` and `META_APP_SECRET`, plus `META_ADS_READ_TOKEN` for read mode or `META_ADS_MANAGEMENT_TOKEN` for write mode. Missing, malformed or different-app configuration makes zero provider requests.

The preflight makes at most three GET requests:

1. The official `/debug_token` endpoint verifies `is_valid`, the configured app ID, scopes, expiry and granular account grants when present. Read accepts `ads_read` or `ads_management`; write requires `ads_management`. Omitted token expiry is unknown and blocked; an explicit zero follows Meta's non-expiring token convention. Data-access expiry is checked when returned.
2. The configured app's identity and business ownership must match **BROS Commercial Intelligence** and `2091328444802994`.
3. The fixed ad account must belong to that portfolio and return active account status, MYR and Asia/Kuala_Lumpur. Write mode also requires its token-holder `user_tasks` to include `ADVERTISE` or `MANAGE`; analyst-only or absent task evidence cannot become write readiness.

Meta's documented `input_token` query on `/debug_token` is a narrow server-only exception to bearer-only business API requests. The app access token is sent in the Authorization header. Do not log the introspection URL, raw exception or provider body, or enable fetch/SDK debug logging around this endpoint. Redirects are rejected; requests use no-store and a ten-second timeout. Errors return fixed sanitized reasons.

Subsequent business API reads, campaign writes, spend monitoring and media upload also reject redirects and sanitize transport/JSON failures before a route can return or store the reason. Only bounded numeric provider codes may enter those error messages.

Manual and scheduled reads, studio staging/activation/pause, asset upload and the pause monitor now use this preflight in the local source. Passing it establishes credential/account checks only: it does not change the independent write-enable flag, approve a plan, activate a campaign, verify Purchase attribution or authorize spend.

## Remaining live gates

1. Complete the current Meta account-recovery flow personally, including any security challenge or 2FA. The operator must stop at these challenges. Recheck the approved AKU assignments after access is restored, since their submission redirected before persistence could be verified.
2. Preserve app `1315572270590189`, its verified portfolio link and Marketing API use-case evidence. Permission screens alone are not token verification. The existing Conversions API System User has pixel/dataset assignments and is not the BCI ad-account integration identity; do not repurpose it by assumption.
3. Issue a minimally scoped provider credential for that existing app and approved account using Meta's authorized owner flow; record issuance, expiry and revocation. Set it directly in Vercel's private encrypted secret store. Never paste secrets into chat, commit them, or reuse a connector session token.
4. Review, deploy and exercise this preparation only after the correct app is identified. Verify the protected BCI administrator flow and live GET preflight. Unit tests use synthetic credentials and do not prove provider acceptance.
5. Preserve the independent write lock and approve a concrete campaign plan separately before PAUSED staging or activation.

The RM100 deployment cap is currently a per-flight guard: every BCI plan must fit within it and still needs its own approval. It does not enforce an account-wide lifetime ceiling or cumulative spending across sequential plans. The recorded first-pilot limit is not standing authorization for repeated RM100 pilots. Leave live Meta ads unchanged; do not increase, activate or repeatedly consume that allowance without plan-specific authorization and verified credentials.

## Local validation

All 43 unit tests passed, including fail-closed identity/task checks and secret-bearing provider-error cases. The full-repository TypeScript check and Next production build passed. The independent review's account-task and error-redaction findings were addressed and reviewed again with no remaining blocking findings. Tests use synthetic credentials; no successful current Meta credential request is claimed. This source has not been promoted to Production.

## Primary API references

- [Meta Marketing API official Postman overview](https://www.postman.com/meta/facebook-marketing-api/overview)
- [Meta official PHP SDK debug-token implementation](https://github.com/facebookarchive/php-graph-sdk/blob/5.x/src/Facebook/Authentication/OAuth2Client.php)
- [Meta official PHP SDK token metadata/expiry validation](https://github.com/facebookarchive/php-graph-sdk/blob/5.x/src/Facebook/Authentication/AccessTokenMetadata.php)
- [Meta official Business SDK Application fields](https://github.com/facebook/facebook-nodejs-business-sdk/blob/main/src/objects/application.js)
- [Meta official Business SDK v24 AdAccount fields and tasks](https://github.com/facebook/facebook-nodejs-business-sdk/blob/v24.0.1/src/objects/ad-account.js)

The Graph SDK is archived and supports the documented introspection convention; the actual app's current permission access and API response still require authenticated live verification.

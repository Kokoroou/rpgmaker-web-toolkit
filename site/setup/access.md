# Protect the site and invite players

**Cloudflare Access** (free for 50 users) asks every visitor for an allowed email before the game loads. Each email gets its own saves. Access is part of Cloudflare **Zero Trust**, which asks for a payment method even on its Free plan ([what it costs](/setup/cloudflare#what-it-costs)).

## Turn on Access

At the end of the first deploy, choose `1) Cloudflare Access`. The toolkit opens the game's settings in the Cloudflare dashboard:

1. **Domains & Routes** → on the **workers.dev** row, select **Enable Cloudflare Access**.
2. First time with Zero Trust? Pick a **team name**, the **Free** plan and a payment method: see [Zero Trust, during the first deploy](/setup/cloudflare#_4-zero-trust-during-the-first-deploy).
3. Back in PowerShell, press **Enter**. Once Access is detected, the game is published unlocked.

<!-- Screenshot wanted: cf-access-enable.png, Settings → Domains & Routes with Enable Cloudflare Access on the workers.dev row -->

It can take a minute; choose **Check again** if needed. Chose **Later**? The site stays [locked](/setup/first-deploy#lock-protect-play); run the deploy again when ready.

::: details The toolkit does not detect Access
Choose **Enter the team domain and AUD manually**:

- **Team domain**: `<team name>.cloudflareaccess.com` (in the address bar of the login page).
- **AUD tag**: [Zero Trust](https://one.dash.cloudflare.com) → **Access controls** → **Applications** → the game → *Application Audience (AUD) Tag*.
:::

## Invite players

Only your Cloudflare account's email can sign in at first. Cloudflare made a policy for the game, named after its site: `<site name> - Production`. To add someone:

1. In **Workers & Pages** → the game → **Settings** → **Domains & Routes**, select **Manage Cloudflare Access**. Or: [Zero Trust](https://one.dash.cloudflare.com) → **Access controls** → **Policies** → `<site name> - Production`.
2. Edit the policy → **Include** → add an **Emails** rule → type their email. **Save**.

<!-- Screenshot wanted: cf-access-policy.png, the policy editor with an Emails rule (addresses blurred) -->

Players need no Cloudflare account: they get a one-time code by email and sign in as in [Open and play](/play/). Each game has its own list, and each email its own saves.

Every deploy prints how many emails have saves. Sharing a copy widely is redistribution, so it warns above 5 (above 1 if the creator asked for [personal copies](/creators/policy)).

## A public site (no protection)

`2) No protection` lets anyone with the link play, and **everyone shares one set of saves**. It is only for games you may redistribute, so the toolkit asks why:

```
? Why may this game be public?
     1) I made this game, or I publish it for the people who made it
     2) Its creators allow anyone to host it publicly (its license or their written permission says so)
     3) Neither: keep the site locked and use Cloudflare Access instead
```

Then whether search engines may list it (no by default; otherwise every site sends `noindex`). A creator's [hosting policy](/creators/policy) can rule this option out.

## If Access gets turned off

Every deploy checks. If it says `Cloudflare Access is NO LONGER protecting the site!`, redo step 1 above.

**Next:** [Update the game](/setup/updating)

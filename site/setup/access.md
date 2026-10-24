# Protect the site and invite players

The toolkit uses **Cloudflare Access** (part of Cloudflare Zero Trust, free for up to 50 users). Every visitor has to sign in with an email you allowed before the game even loads, and each email gets its own saves.

## Turn on Access

At the end of the first deploy, the toolkit asks:

```
? Option
  › Cloudflare Access: email login, saves tied to the email (recommended)
    No protection: a public site anyone can open, everyone shares saves
    Later (keep the site locked)
```

Choose **Cloudflare Access**. The toolkit opens the game's settings page in the Cloudflare dashboard. There:

1. Under **Domains & Routes**, find the **workers.dev** row and turn on **Cloudflare Access**.
2. If this is your first time using Zero Trust, Cloudflare asks you to choose a **team name** and a plan. Pick the **Free** plan.
3. Go back to PowerShell and press **Enter**. The toolkit checks the site and, once Access is detected, publishes the game again unlocked.

Changes can take about a minute to apply. If the check fails, choose **Check again**.

::: details Access is on but the toolkit does not detect it
Choose **Enter the team domain and AUD manually**:

- **Team domain**: `<team name>.cloudflareaccess.com`. It is shown in the Zero Trust settings, and in the address bar of the login page you see when you open the game.
- **AUD tag**: Zero Trust → Access → Applications → the game's application. Its details show the *Application Audience (AUD) Tag*, a long hex string.
:::

::: tip Choosing "Later"
The site stays locked and nobody can open it. Run the same deploy command again when you are ready; it picks up where you left off.
:::

## Invite players

By default, **only your Cloudflare account's email** can sign in. To let other people in, or another email of yours:

1. Open [Cloudflare Zero Trust](https://one.dash.cloudflare.com) → **Access** → **Applications**.
2. Open the game's application (named after the Worker).
3. Go to **Policies** and edit the allow policy.
4. Under **Include**, add a rule **Emails** with each person's email. Save.

Every game you publish has its own application, so you can allow different people per game.

::: warning Saves belong to the email
Each email has its own saves. A friend who signs in with their email starts their own game; they never see or overwrite yours.
:::

## How players sign in

When someone opens the link, Cloudflare shows a login page:

1. They type their email.
2. Cloudflare emails them a one-time code (if their email is allowed).
3. They type the code and the game opens.

The login lasts for a while (the session length set on the application), then they sign in again. See [Open and play](/play/).

## No protection

**No protection** makes the site public: anyone with the link can play, and **everyone shares the same saves**. A public site is redistribution of the game, so the toolkit asks why it may be public:

```
? Why may this game be public?
     1) I made this game, or I publish it for the people who made it
     2) Its creators allow anyone to host it publicly (its license or their written permission says so)
     3) Neither: keep the site locked and use Cloudflare Access instead
```

Then it asks whether search engines may list the site (no by default). The answer is kept in the game's settings (`auth.basis`, `indexable`).

- If the game's creator ships a [hosting policy](/creators/policy) that keeps the game private, *No protection* is not offered, and a site that was public is locked until Access is on.
- Sites that were public before this question existed are asked once on the next deploy.

::: tip Search engines
Unless a public site asks to be listed, every site sends `X-Robots-Tag: noindex` and a `robots.txt` that keeps crawlers out, so it does not show up in search results.
:::

## How many people play

Each deploy shows how many emails have saves for the game. Sharing your copy with many people is redistribution, so the toolkit warns above 5 emails, or above 1 when the game's creator asked for personal copies only.

## Checking the protection later

Every deploy checks that Access still protects the site. If it was turned off in the dashboard, the deploy warns:

```
Cloudflare Access is NO LONGER protecting the site!
```

Turn it back on as in [Turn on Access](#turn-on-access), step 1.

**Next:** [Update the game](/setup/updating)

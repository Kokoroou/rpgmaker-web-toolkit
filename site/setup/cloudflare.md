---
description: "Create and prepare a free Cloudflare account for an RPG Maker web game: workers.dev subdomain, R2 and Access, what each step costs and why a card is asked."
lang: en
---

# Set up Cloudflare

The game goes on **your own Cloudflare account**: Cloudflare hosts it, keeps the saves and checks who signs in. Never used Cloudflare? This page goes through the account once, in about 10 minutes. You only do it once, for all your games.

Cloudflare changes its dashboard often. If a button has another name, look for the words in **bold** nearby, or use the search box at the top of the dashboard.

## What it costs

Nothing, for normal use. But two of the services need a **payment method** on file, even on their free plans:

| Service | What the toolkit uses it for | Free plan | Payment method |
|---|---|---|---|
| **Workers** | The game's site, at `https://<game>.<subdomain>.workers.dev` | Game files served for free, up to 20,000 per game; 100,000 save requests a day | Not needed |
| **R2** (storage) | Saves, each game's settings, files over 25 MiB | 10 GB; 1 million writes and 10 million reads a month | **Needed** to turn it on |
| **Zero Trust** (Cloudflare Access) | The email login in front of the game | 50 users | **Needed** to choose the Free plan, never charged |
| A domain name | Not used: games live on `workers.dev` | | |

::: warning Do I need a Visa card?
**Yes, or another way to pay.** R2 asks for one when you turn it on, and Zero Trust when you choose its Free plan. The toolkit cannot run without R2, since it keeps every game's settings there.

Cloudflare takes **Visa, Mastercard, American Express, Discover, UnionPay**, and **PayPal**, **Apple Pay** or **Google Pay**. Your bank may ask you to confirm (3D Secure). When you add a card, Cloudflare may put a small temporary hold on it (about US$5) to check it; the hold goes away and is not a charge. If your card is refused, PayPal usually works.
:::

**What could cost money**, and why the toolkit stays far from it:

| Service | Past the free plan | With the toolkit |
|---|---|---|
| R2 | **Billed** to your payment method: there is no cap | A save weighs a few KB, even with its [older copies](/play/saves#bring-back-an-older-save). Only files over 25 MiB (usually movies) take real space, shared by all your games |
| Workers | Requests fail until the next day; nothing is billed on the Free plan | Normal game files are not counted, only saves and R2 files |
| Zero Trust | Person 51 cannot sign in; nothing is billed | Each game's player list counts the same people once |

The numbers: [Free plan limits](/reference/limits). Check **Billing** in the dashboard now and then if you upload large files.

## 1. Create the account

1. Open [dash.cloudflare.com/sign-up](https://dash.cloudflare.com/sign-up). Enter your email and a password.
2. Open the email from Cloudflare and select the link to **verify your email**. Some services stay locked until you do.
3. The dashboard may offer to add a website or a domain, or to pick a plan for one: skip it. The toolkit needs no domain, and the account's free plan is enough.
4. Recommended: turn on **two-factor authentication** (your profile icon, top right → **Profile** → **Authentication**). The account holds your games and your players' saves.

<!-- Screenshot wanted: cf-signup.png, the sign-up form -->

## 2. Pick your workers.dev subdomain

1. In the sidebar, open **Workers & Pages** (it may sit under **Compute**).
2. The first time, Cloudflare asks you to choose a **subdomain**. Otherwise, select **Change** next to **Your subdomain**.
3. Pick something short, such as your username: it is part of every game's link, `https://<game>.<subdomain>.workers.dev`, and players see it. Changing it later changes every link.

A new subdomain can take a few minutes to work.

<!-- Screenshot wanted: cf-subdomain.png, Workers & Pages with "Your subdomain" -->

## 3. Turn on R2

1. In the sidebar, open **R2 Object Storage** (it may sit under **Storage & databases**).
2. Select the button to get R2 (**Purchase R2** or similar). It opens a checkout for the **R2 subscription**: the plan itself is $0, usage over the free amounts is billed monthly.
3. Add your payment method and confirm.

Do not create a bucket: the toolkit creates its own, `rpgmaker-web-toolkit`, at the first deploy.

<!-- Screenshot wanted: cf-r2.png, the R2 page before and after the checkout (card details hidden) -->

## 4. Zero Trust, during the first deploy

Nothing to do now. At the end of the [first deploy](/setup/first-deploy), the toolkit opens the game's page in the dashboard to turn on **Cloudflare Access**. The first time, Cloudflare first sets up **Zero Trust** (also called **Cloudflare One**):

1. **Team name**: an internal name for your Zero Trust organization. Players see it in the address of the login page, `https://<team name>.cloudflareaccess.com`, so keep it neutral. It can be changed later in **Zero Trust** → **Settings**.
2. **Plan**: choose **Free** (up to 50 users).
3. **Payment details**: asked even for the Free plan, which is not charged. If you already added a payment method for R2, select it.

Then follow [Protect the site and invite players](/setup/access).

<!-- Screenshots wanted: cf-zt-team.png (team name), cf-zt-plan.png (Free plan) -->

## Good to know

- **Cloudflare's rules apply to your account.** You accept Cloudflare's terms when you sign up, and you are responsible for what your account publishes. Publishing a game you may not share can get the site taken down after a copyright complaint: see *Responsible use* on the [home page](/).
- **The toolkit's login is limited.** It asks only for the permissions it needs, and lives in its own wrangler profile on your PC. [Remove it](/setup/first-deploy#what-stays-on-the-pc) whenever you like.
- **Stopping.** To remove a game, delete its Worker (**Workers & Pages** → the game → **Settings** → **Delete**). To stop everything, also delete the R2 bucket `rpgmaker-web-toolkit` (it holds the saves of all your games: [export](/play/save-files#export) the ones you want first) and, in **Billing** → **Subscriptions**, cancel R2 and Zero Trust.

**Next:** [First deploy](/setup/first-deploy)

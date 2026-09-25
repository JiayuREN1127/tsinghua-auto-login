# Tsinghua Auto-Login

*Because you should not have to fight your own university's login page every single day.*

A Chrome extension that automatically signs you in to Tsinghua University's identity
system, email, and the scattered web services that all insist on their own login
flow. Born out of pure exasperation.

> **Why does this exist?**
>
> Tsinghua University runs one of the world's most prestigious institutions of
> higher learning, and also one of the most aggressively backwards pieces of
> digital infrastructure ever shipped to students. The unified identity system
> (`id.tsinghua.edu.cn`) asks you to re-enter your username and password for
> services that should already share one session. The email system runs a
> separate Coremail instance with its *own* credentials, because of course it
> does. Web Learning (`learn.tsinghua.edu.cn`) has a login button that exists
> only to bounce you to another login page. The library, sports-booking, and
> half a dozen other systems each reinvent the wheel, then charge you a toll
> to roll it.
>
> Nothing talks to anything else. Every login is slow, scattered, and manual.
> In 2026, at China's flagship university. This extension is the author's
> humble, angry protest, written in the only language the systems seem to
> respect: automated clicking.

## What it fixes

| System | How |
|---|---|
| Unified identity `id.tsinghua.edu.cn` | Fills the form, reuses the page's own `$.submitForm()` (SM2 encryption, fingerprinting, "trusted browser" checkbox all handled by the page, as they should be) |
| Email `mail*.tsinghua.edu.cn` | Auto-fills the Coremail form (`#uid`/`#password`), clicks the native `.j-submit` — because yes, the mail account is separate from the unified account |
| Web Learning, library, venue booking, etc. | Auto-clicks any login entry that redirects to the unified identity system, so the real login happens there silently |

Captcha (when the systems decide to be extra annoying): auto-recognized;
retried 3 times on failure; degrades gracefully to "please type it, human",
with the input focused and highlighted. A 60-second cooldown prevents
login-failure death loops.

## Credentials

The unified identity account and the mail account are **separate credentials**,
stored **independently** in `chrome.storage.local` — never synced to the cloud,
never leaving your machine. Two independent sections in the popup, two
independent clear buttons.

## Install

1. Clone or download this repo.
2. Open `chrome://extensions`, enable **Developer mode** (top-right).
3. Click **Load unpacked**, select this directory.
4. Click the extension icon, fill in your credentials (one or both sections), save.

## Usage

- Visit any Tsinghua service that bounces you to unified login → automatic.
- Open the mail system → automatic.
- Captcha appears? Auto-solve first; if that fails, the field is highlighted,
  type the 4 characters and it submits on its own.
- Toggle or wipe credentials anytime from the popup.

## How it works

- `background.js` listens on `tabs.onUpdated` and routes by hostname to three
  fully self-contained injected scripts (`world: "MAIN"` so they can touch the
  page's own jQuery):
  - `AUTO_LOGIN_MAIN` — unified identity login page
  - `AUTO_LOGIN_MAIL` — Coremail login page
  - `AUTO_CLICK_CAS_ENTRY` — generic clicker for unified-auth redirect entries
- Captcha solving: color-saturation segmentation + column-projection character
  splitting + multi-font template matching, verified through the page's own
  `checkCaptcha` API with auto-retry.
- Injected functions are deliberately self-contained because
  `chrome.scripting.executeScript` serializes only the function body, not its
  closure. Future maintainers, do not "refactor" this away.

## A note on the future

Tsinghua will eventually replace these systems. On that day, this repository
will quietly retire, and its author will shed a single tear of relief. Until
then: enjoy not typing your password into four different logins per day.

---

*Only log into accounts you are authorized to use. Obey Tsinghua's network
policies. Logging in for yourself is not a crime; automating your own misery is
a survival strategy.*

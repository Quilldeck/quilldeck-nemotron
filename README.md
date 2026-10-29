# Quilldeck

**The launch toolkit for independent authors: KDP-ready blurbs and a complete book-launch plan, written by NVIDIA Nemotron on Nebius Token Factory.**

**Live demo:** https://quilldeck-nemotron-api.vercel.app (free, no sign-up)

Submission for the [Nebius x NVIDIA Global AI Hackathon](https://nebiusglobalaihackathon.devpost.com/), Best Apps and Agents track.

---

## The problem

An independent author finishes a book and then has to become a copywriter, an ad buyer and a social media manager overnight. Generic AI tools make this worse in a specific way: given a synopsis, they fill every gap with invented detail. They swap which parent a character descends from, invent an abduction that never happens, and promise readers a live Q&A or a free map the author never planned. For an author, copy that misrepresents the book is worse than no copy.

## What it does

Enter your book once: title, author, series, launch date, genre, synopsis, and optionally the facts the copy must get right.

- **Write 3 blurbs.** Three 150 to 200 word, KDP-ready blurbs, each with a different hook: emotional, action and mystery. Pick one to carry into the launch plan.
- **Build the launch plan.** Five platform-specific social posts, three launch emails signed in the author's name, three Amazon ad variants with keywords, a 14-day posting calendar and promo-site suggestions.
- **Facts the copy must get right.** The author states what must not be changed or invented (for example, "his father is Yoruba and his mother is Anglo-Saxon; Klan is not Yoruba"), and every request is bound by it.
- **Series aware.** A book that opens a series is pitched as the way in, without inventing titles or plots for later books.
- **Live promo-site research.** Tavily searches the web for promotion services that suit the book's genre; Nemotron picks the best five using only those pages. Each recommendation shows its current price and rules and links to the page it came from.
- **Afroeurofantasy support.** For this subgenre, a dedicated primer makes the named African and European traditions shape the world, without guessing which character carries which heritage.

## How it uses NVIDIA Nemotron and Nebius Token Factory

Every word the app produces comes from a live runtime call to **`nvidia/nemotron-3-super-120b-a12b`** through the **Nebius Token Factory** OpenAI-compatible API (`https://api.tokenfactory.nebius.com/v1/chat/completions`). The integration is in [`quilldeck-api/lib/nebius.ts`](quilldeck-api/lib/nebius.ts).

What we learned building on it, and how the code responds:

| Finding | What the code does |
|---|---|
| With reasoning on, Nemotron 3 Super took 30 to 90 seconds per request on the shared endpoint. | Reasoning is switched off with `chat_template_kwargs: {"enable_thinking": false}`, which cut blurb generation to 4 to 10 seconds with no visible loss in copy quality. It falls back automatically if an endpoint rejects the setting (`NEBIUS_THINKING=on` restores reasoning). |
| One long five-section JSON request sometimes came back with whole sections missing. | The launch plan runs as smaller requests in parallel. The server checks every expected section and retries only what is missing, within the time limit. |
| The model occasionally returned the JSON template itself (`"<first blurb>"`) instead of writing. | The blurb endpoint rejects placeholders and blurbs under 60 words, then retries. |
| Given a vague synopsis, the model invented story facts and drifted on invented names (Gardenia, Gardena, Gardinia). | Every prompt treats the synopsis and the author's facts as the only source of truth, and passes an exact-spelling list of the book's proper nouns. |
| Without explicit limits, launch copy invented events, giveaways, prices and social handles. | The prompts forbid them and use clear placeholders instead, e.g. `[pre-order link]`. |

### The agent workflow: plan, write, check, repair, research

Quilldeck does not send one prompt and hope. Each request runs as a small agent workflow on Nemotron:

1. **Plan.** The book is entered once. The app turns it into separate jobs (blurbs; posts and emails; Amazon ads; a 14-day calendar; promo research), each carrying the author's facts and an exact-spelling list of the book's names.
2. **Write.** Nemotron drafts each part, in parallel where it can.
3. **Check its own output.** The server inspects every result for missing sections, echoed templates, and blurbs that are too short, unpunctuated or in the first person. It keeps what passes and asks again only for what failed.
4. **Fact-check and repair.** A second Nemotron pass acts as a continuity editor. It reads the blurbs against the author's synopsis and facts, flags any sentence that contradicts them, invents a specific event, name or quotation, or misspells a name, and makes the smallest fix. A repair is accepted only if it still passes every quality check, and the author sees exactly what was corrected and why.
5. **Research and verify.** For promotion, Tavily searches the live web, Nemotron chooses only from what was found, every recommendation must cite a source, and every website link is checked before it is shown.

### Live research with Tavily

Promo-site suggestions used to come from the model's memory, which meant out-of-date prices and occasionally sites that no longer exist. [`quilldeck-api/api/research-promo.ts`](quilldeck-api/api/research-promo.ts) now runs three Tavily searches in parallel at request time, passes the results to Nemotron with the instruction to use nothing else, and then drops any recommendation that does not cite one of the URLs Tavily returned. The endpoint builds its searches from book fields and never accepts a free-form prompt.

Other details: strict JSON mode with a fallback, `temperature 1.0` and `top_p 0.95` (NVIDIA's recommended sampling), a model fallback list via `NEBIUS_MODELS` for busy periods, and error messages that tell the user what actually went wrong.

## What changed during the hackathon

Quilldeck existed before this hackathon as an Android app built on a different model provider. Everything below was built during the submission period:

- Moved all inference to **NVIDIA Nemotron 3 Super on Nebius Token Factory** (new `lib/nebius.ts`).
- Built the **web app** (`quilldeck-api/public/index.html`) so anyone can use Quilldeck in a browser without installing an Android build.
- **Book details entered once** and shared by both tools.
- New **story-accuracy layer**: the facts field, fidelity rules, exact-name spelling and the no-invention rules.
- **Live promo-site research** with Tavily, with every recommendation tied to a source URL.
- **Series** field and series-aware launch copy.
- **Fact-check agent step**: a second Nemotron pass checks every blurb against the synopsis and facts, repairs contradictions and invented details, and reports each correction.
- **Demo protection**: endpoints serve only the app's own page (same-origin check, request-size cap, Quilldeck request markers, per-visitor rate limit), in [`quilldeck-api/lib/guard.ts`](quilldeck-api/lib/guard.ts).
- **Reliability work**: reasoning off for speed, the launch plan split into three parallel requests, per-section validation and retries, placeholder detection.

## Run it yourself

The web app and the API are one Vercel project, in the `quilldeck-api` folder.

1. Get an API key from [Nebius Token Factory](https://tokenfactory.nebius.com).
2. Deploy `quilldeck-api` to Vercel (set the project's Root Directory to `quilldeck-api`).
3. Add the environment variables `NEBIUS_API_KEY` (Nebius Token Factory) and `TAVILY_API_KEY` ([Tavily](https://tavily.com)).
4. Open the deployment URL. The web app is served from `/`, and the API from `/api/generate-blurb`, `/api/generate-marketing`, `/api/research-promo` and `/api/generate-metadata`.

Optional environment variables:

- `NEBIUS_MODELS`: a comma-separated list of models to try in order when one is busy. Defaults to `nvidia/nemotron-3-super-120b-a12b`.
- `NEBIUS_THINKING=on`: turns Nemotron's reasoning back on.

There is no build step and no npm dependencies; the functions use the platform `fetch`.

## Project structure

```
quilldeck-nemotron/
├── quilldeck-api/          # The hackathon entry: Vercel project
│   ├── public/index.html   # Web app
│   ├── api/                # Serverless endpoints (blurb, marketing, promo research, metadata)
│   └── lib/nebius.ts       # Nemotron on Nebius Token Factory client
├── app/, components/,      # Android app source (Expo / React Native), included
│   constants/, src/        # for reference; it still calls the original backend
└── LICENSE                 # MIT
```

## About

Built by [Phoenix F. Black](https://quilldeck.app), author, publisher and CEO of Taoscope Labs Ltd. Quilldeck is the tool he needed while launching his own Afroeurofantasy novel, *The Silent One*.

- Web: [quilldeck.app](https://quilldeck.app)
- X: [@quilldeck0](https://x.com/quilldeck0)

## License

The code is released under the MIT licence. See [LICENSE](LICENSE).

The Quilldeck name, logo and brand assets are not licensed under MIT. They remain the property of Taoscope Labs Ltd and may not be used to identify a derivative product or service.

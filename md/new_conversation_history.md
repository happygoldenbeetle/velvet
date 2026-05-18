# Read code and history

> read the entire code and [conversation_history.md](conversation_history.md) to understand the context

<details><summary>4 previous messages</summary>

> I’ll map the workspace first, then read the conversation history and the code in passes so I can build a useful mental model instead of just skimming filenames.
>
> I’ve got the history now. The workspace is a small Electron app rather than a large repo, so I’m going to ignore vendored `node_modules` and read the actual app files, package metadata, and SVG assets that define the current behavior.
>
> A quick note: the history file itself looks mojibake-encoded in places, but the meaning is clear. I’m seeing the app has accumulated a lot of visual polish and state behavior, and I’m checking the current source now against that story.
>
> The main app logic is coherent with the history: vanilla renderer code, TMDB wrapper, Electron shell, and a single stylesheet doing most of the product feel. I’m doing one more pass for hidden files/package lock shape and line references so my summary is grounded in the actual tree.

</details>

I’ve read the app-owned code and [conversation_history.md](./conversation_history.md). I treated `node_modules/` as vendored dependency code, not project source.

Current mental model:

- This is **Cinemax**, a Netflix-inspired Electron desktop app.
- Electron shell lives in [main.js](./main.js) with a frameless window, ad/tracker URL blocking, popup blocking, and window-control IPC.
- Preload bridge is minimal: [preload.js](./preload.js) only exposes minimize/maximize/close.
- UI structure is in [src/index.html](./src/index.html).
- TMDB, VidSrc, anime discover endpoints, and IMDb/Cinemeta rating lookup are in [src/js/api.js](./src/js/api.js).
- Main renderer behavior is in [src/js/app.js](./src/js/app.js): tabs, per-tab hero persistence, search, cards, modal, My List, TV episode picker, and player episode panel.
- Styling is all in [src/css/style.css](./src/css/style.css): Netflix Sans, `#141414` background, 4px poster cards, subtle blended arrows, modal/player/search/list layouts.
- Custom SVG assets are under [src/assets/svgs](./src/assets/svgs).

A few context notes I’ll keep in mind:

- The conversation history describes many iterative UI refinements, and the current code mostly matches that final state.
- The TMDB API key is still hardcoded in renderer-side [api.js](./src/js/api.js:5), despite the history mentioning API-key exposure as a concern.
- There’s no Git repo initialized here, so I can’t rely on `git status` or diffs.
- Some comments/text use Unicode separators and symbols; shell output showed encoding weirdness in places, but the source itself includes readable characters like `★`, `•`, and `—`.

I’m up to speed.

> can we add a contuniue watching tab with a red progress line on the bottom of the card that remembers where i left off and starts the movie from there or something? you might need to see how the embedder works for better understandinf of this

<details><summary>7 previous messages</summary>

> Yeah, this is doable as an app feature, but there’s one important boundary: the app can reliably remember what title/episode you opened and when, while exact playback timestamp resume depends on whether the embedded player exposes or accepts a time parameter. I’m going to verify what the current embed URLs support, then I’ll wire the local “Continue Watching” experience around the parts we can control.
>
> <details><summary>Searched web 1 time</summary>
>
> <details><summary>Searched web 1 time</summary>
>
> - Searched web for `vidsrc-embed.ru embed start time parameter tmdb autoplay season episode`
>
> </details>
>
> </details>
>
> The current public docs I found for VidSrc-style embeds list a `t` query parameter for starting at a timestamp in seconds. That gives us a reasonable resume hook; for tracking, I’ll store an approximate watched position from time spent in the player, because the embedded cross-origin player does not expose reliable pause/seek events to the host app.
>
> I’m going to add this as a local session feature: a new tab, a persisted `localStorage` history, red progress bars on those cards, and resume URLs that append `t=<seconds>` when there’s saved progress. I’ll keep it scoped to the existing vanilla JS structure.
>
> <details><summary>Edited 4 files</summary>
>
> - Wrote `./src/js/api.js` (+14 -4)
> - Wrote `./src/index.html` (+4 -0)
> - Wrote `./src/js/app.js` (+4 -0)
> - Wrote `./src/js/app.js` (+1 -0)
> - Wrote `./src/js/app.js` (+149 -0)
> - Wrote `./src/js/app.js` (+26 -0)
> - Wrote `./src/js/app.js` (+22 -3)
> - Wrote `./src/js/app.js` (+40 -0)
> - Wrote `./src/js/app.js` (+3 -1)
> - Wrote `./src/js/app.js` (+4 -2)
> - Wrote `./src/js/app.js` (+4 -3)
> - Wrote `./src/js/app.js` (+8 -1)
> - Wrote `./src/js/app.js` (+10 -1)
> - Wrote `./src/js/app.js` (+2 -0)
> - Wrote `./src/js/app.js` (+1 -0)
> - Wrote `./src/css/style.css` (+14 -1)
>
> </details>
>
> The first implementation pass is in. I’m checking syntax now, then I’ll run the Electron app briefly so I can catch obvious renderer errors from the new tab/session code.
>
> Syntax checks passed for the edited renderer/API files. I’m doing one small cleanup pass around the resume behavior now: the feature is intentionally “best effort” for timestamp accuracy, because the embedded player lives inside a cross-origin webview and doesn’t hand us its exact current playback time.

</details>

Implemented it.

You now have a **Continue Watching** tab in the top nav, backed by `localStorage`, with cards showing a red progress line at the bottom. When you reopen something from that tab, the app passes the saved timestamp back into the embed URL using `t=<seconds>`, which VidSrc-style docs list as the start-time parameter: [VidSrc Wiki](https://vidsrc.wiki/).

Changed files:

- [src/index.html](./src/index.html:43) adds the new nav tab.
- [src/js/api.js](./src/js/api.js:149) adds optional resume timestamps to movie/TV embed URLs.
- [src/js/app.js](./src/js/app.js:9) adds progress storage, resume cards, player session tracking, and continue-page behavior.
- [src/css/style.css](./src/css/style.css:260) adds the red progress line and small watch-time label.

One honest caveat: because the video player is inside a cross-origin Electron `webview`, the app cannot reliably read the embedder’s exact paused/seeked playback time. So it tracks “time spent in the player” and saves every 5 seconds. Resume should work if the embedder honors the `t` parameter, but it may be approximate if the user pauses, seeks, or sits through embed-side loading/ads.

Verification: `node --check` passes for `main.js`, `preload.js`, `src/js/api.js`, and `src/js/app.js`; `npm ls --depth=0` is clean.

> will the saving every 5 sec add load

Barely. It’s just updating a small array in `localStorage` every 5 seconds while the player is open, usually one JSON write of a few KB at most. That is negligible compared to the embedded video playback.

The only tiny cost is that `localStorage` writes are synchronous, so if the list grew huge it could cause a micro-stutter. I capped it at 40 entries, so it should stay light.

If you want it even lighter later, we can change it to save every 15-30 seconds plus once when closing the player.

> what if it exceeds 40 entries? will it delete previous oneS?

Yes. It keeps the **40 most recently updated** entries.

When a new or resumed item is saved, the list is sorted by `updatedAt` newest first, then trimmed with:

```js
.slice(0, 40)
```

So if it becomes 41 entries, the oldest/least recently watched entry drops off automatically.

> why not just use 1 or 2 then? we only need one anyway

For the tab, 40 means it can show a whole “Continue Watching” library, like Netflix does. But for the actual resume behavior, you’re right: if you only care about **the last thing you watched**, 1 is enough.

A middle ground I’d prefer is maybe **10**: still tiny, keeps recent movies/episodes around, and avoids losing progress when you bounce between a few shows.

Using **1** would mean:

- Start Movie A, progress saved.
- Start Episode B, Movie A disappears.
- Go back to Movie A later, no resume.

So 40 is not for performance. It’s for UX memory. Performance is basically unchanged whether it’s 1, 10, or 40.

> ohhh, no i was talking during the player

Ahh got you. During the player, it’s still only saving **one active thing** every 5 seconds: the movie or the exact TV episode currently open.

The 40 limit is just the size of the saved Continue Watching list. It doesn’t mean it saves 40 items every 5 seconds. Each tick updates/replaces the current active entry, then trims the list.

So the per-player work is tiny:

```txt
1 active item -> update progress -> write small Continue Watching list
```

We could make it a bit cleaner by only writing the single active entry during playback and sorting/trimming on close, but practically this won’t add meaningful load.

> if i watch episode 1 of a series and switch to ep2 when the ep1 have 5 seconds left and watch half ep2 will it add 2 entries? ep 1 and 2?

With the code as written: **no, Episode 1 probably won’t stay in Continue Watching** in that case.

Why: when you switch from E1 to E2, the app saves E1’s progress, but anything past **92% watched** is treated as basically finished and removed from Continue Watching. If E1 has only 5 seconds left, it will exceed that threshold, so it gets dropped.

Then E2 becomes the active watch session, and after you watch half of it, **E2 gets added/updated** as the Continue Watching entry.

So you’d end up with:

```txt
Episode 2 only
```

If you switch earlier in E1, before the 92% finished threshold, then yes, it can keep both E1 and E2 as separate entries.

> what if episode 1 is 50% complete

Then yes, you’d get **two entries**:

```txt
Series Name - S1E1   ~50%
Series Name - S1E2   whatever progress you watched
```

Each episode has its own key:

```txt
tv-{showId}-s{season}-e{episode}
```

So E1 and E2 are tracked separately. When you switch to E2, E1 is saved at about 50%, then E2 starts its own progress entry.

> it shuldn't be like that

<details><summary>2 previous messages</summary>

> Agreed, that would feel messy. I’m going to change TV tracking so a show has only one Continue Watching entry: when you move from S1E1 to S1E2, the show’s entry becomes S1E2 instead of keeping both episodes.
>
> <details><summary>Edited 1 file</summary>
>
> - Wrote `./src/js/app.js` (+1 -1)
> - Wrote `./src/js/app.js` (+6 -0)
> - Wrote `./src/js/app.js` (+1 -1)
> - Wrote `./src/js/app.js` (+18 -0)
> - Wrote `./src/js/app.js` (+0 -14)
>
> </details>

</details>

Agreed. I changed TV tracking so a series gets **one Continue Watching entry per show**, not one per episode.

Now the behavior is:

```txt
Watch S1E1 to 50%
Switch to S1E2
Continue Watching updates the same show entry to S1E2
```

So you’ll see **only the latest episode you were watching** for that series. Movies still each get their own entry.

I also adjusted resume logic so pressing Play on a show resumes the saved latest episode instead of blindly starting S1E1. `node --check src/js/app.js` passes.

> i noticed that you created a whole new tab for continue watching. i want it to be a heading on home page just like netflix

<details><summary>4 previous messages</summary>

> Got it, that fits the Netflix pattern better. I’ll remove the separate nav tab and make Continue Watching a home-page row that appears only when there’s saved progress.
>
> <details><summary>Edited 2 files</summary>
>
> - Wrote `./src/index.html` (+0 -4)
> - Wrote `./src/js/app.js` (+0 -1)
> - Wrote `./src/js/app.js` (+23 -0)
> - Wrote `./src/js/app.js` (+2 -0)
> - Wrote `./src/js/app.js` (+1 -1)
>
> </details>
>
> The tab is removed and the home row is wired in. I noticed the old standalone page function is now dead code, so I’m removing that too to keep the file clean.
>
> <details><summary>Edited 1 file</summary>
>
> - Wrote `./src/js/app.js` (+0 -26)
>
> </details>

</details>

Done. I removed the separate **Continue Watching** nav tab and made it a home-page row instead, just like Netflix.

Behavior now:

- It appears at the top of Home, above “Trending Now”.
- It only appears if there’s saved progress.
- It uses the same horizontal row/card style as the rest of Home.
- Closing the player on Home refreshes the row so the latest progress appears.

Verification: `node --check src/js/app.js` passes.

> it isn't appearing, maybe cuz i haven't used the app yet

Yep, exactly. It won’t appear until there’s at least one saved item with **30+ seconds** of watch progress.

Current logic:

```txt
Open movie/show -> stay in player for 30+ sec -> close player -> Continue Watching row appears on Home
```

If you only opened something briefly, it gets filtered out so the row doesn’t show clutter.

For quick testing, we can temporarily lower that threshold from `30` to like `5` seconds.

> move it below trending now

<details><summary>2 previous messages</summary>

> Yep, I’ll reorder the home rows so Trending Now stays first and Continue Watching appears right after it when there’s saved progress.
>
> <details><summary>Edited 1 file</summary>
>
> - Wrote `./src/js/app.js` (+1 -1)
>
> </details>

</details>

Done. On Home, the order is now:

```txt
Trending Now
Continue Watching
Popular Movies
...
```

`node --check src/js/app.js` passes.

> can we add top 10 movies in pakistan from netflix? to the home page? o don't think netflix exposes this through api so we could use an ecxternal source

<details><summary>6 previous messages</summary>

> We can, and you’re right that Netflix itself doesn’t expose a nice app API for this. I’ll look for the most stable public source first, preferably Netflix’s own Top 10 data files, then I’ll wire a Home row without adding a fragile scraper if there’s a cleaner dataset.
>
> <details><summary>Searched web 1 time</summary>
>
> <details><summary>Searched web 1 time</summary>
>
> - Searched web for `Netflix Top 10 Pakistan movies weekly data API CSV`
>
> </details>
>
> </details>
>
> I found Netflix’s own public Tudum Top 10 page for Pakistan films, which is better than scraping a random third-party site. I’m going to fetch that through Electron’s main process to avoid browser CORS issues, extract the ranked titles, then resolve them through TMDB so the row uses the same playable card system as the rest of the app.
>
> The Netflix page has the current Pakistan films list embedded in its rendered HTML table, including this week’s dates. I’ve got a clean extraction path now, and I’ll keep failures quiet so Home still loads normally if Netflix changes the markup or the request times out.
>
> <details><summary>Edited 5 files</summary>
>
> - Wrote `./main.js` (+57 -0)
> - Wrote `./preload.js` (+1 -0)
> - Wrote `./src/js/api.js` (+27 -0)
> - Wrote `./src/js/app.js` (+6 -1)
> - Wrote `./src/js/app.js` (+39 -0)
> - Wrote `./src/css/style.css` (+9 -0)
>
> </details>
>
> The row is now being resolved through TMDB after pulling the ranked names from Netflix’s Tudum Pakistan films page. I’m running parser and syntax checks next, because this sort of external HTML integration is where tiny selector mistakes love to hide.

</details>

Added a Home row for **Top 10 Movies in Pakistan on Netflix**.

It pulls from Netflix’s public Tudum page: [Netflix Top 10 Pakistan Films](https://www.netflix.com/tudum/top10/pakistan/films), then searches each title on TMDB so the row uses normal Cinemax movie cards and playback flow. I also added small red rank badges on those cards.

Files changed:

- [main.js](./main.js:183): fetches/parses Netflix’s Pakistan films list.
- [preload.js](./preload.js:7): exposes the fetch to the renderer.
- [src/js/api.js](./src/js/api.js:149): resolves Netflix titles into TMDB movie results.
- [src/js/app.js](./src/js/app.js:408): adds the row to Home.
- [src/css/style.css](./src/css/style.css:273): styles the rank badge.

I verified syntax for `main.js`, `preload.js`, `api.js`, and `app.js`, and tested the Netflix parser against the current page HTML.

> add top 10 tv series too, also remove the "On Netflix" suffix

<details><summary>3 previous messages</summary>

> Yep. I’ll add the TV list from the matching Netflix Tudum Pakistan TV page, then rename the movies row so it just says “Top 10 Movies in Pakistan.”
>
> The TV Tudum page uses the same table structure, with season labels like “Glory: Season 1.” I’m going to strip those season/limited-series suffixes before searching TMDB so the app resolves the actual show title instead of the season label.
>
> <details><summary>Edited 4 files</summary>
>
> - Wrote `./main.js` (+9 -3)
> - Wrote `./preload.js` (+1 -0)
> - Wrote `./src/js/api.js` (+24 -4)
> - Wrote `./src/js/app.js` (+8 -3)
> - Wrote `./main.js` (+2 -0)
> - Wrote `./src/js/api.js` (+6 -1)
>
> </details>

</details>

Done.

I added a **Top 10 TV Series in Pakistan** row from Netflix Tudum’s Pakistan TV page, and renamed the movie row to:

```txt
Top 10 Movies in Pakistan
```

No more “on Netflix” suffix.

I also made the TV resolver strip season labels like `: Season 1` and `: Limited Series` before searching TMDB, so the cards resolve to the actual show. Duplicate seasons of the same show are collapsed into one card so the row doesn’t show the same series twice.

Verified with syntax checks for `main.js` and `src/js/api.js`.

> the app is nnow taking super long to open maybe becuasse of netflix top 10, wat if instead of getting the entire list in large size from netflix we get a small tiny json and then feed it to tmdb that way the app would open a lot faster

<details><summary>6 previous messages</summary>

> Yeah, that slowdown is very likely from the two Tudum HTML downloads plus TMDB resolving before Home renders. I’ll change it so Home renders immediately, then the Top 10 rows load in the background; I’ll also look for a lighter Netflix data endpoint/file so we’re not pulling huge HTML at startup.
>
> <details><summary>Searched web 1 time</summary>
>
> <details><summary>Searched web 1 time</summary>
>
> - Searched web for `Netflix top10 downloadable country csv tsv official weekly country lists`
>
> </details>
>
> </details>
>
> I found references to Netflix’s official weekly country lists, but not a stable tiny JSON endpoint in the public docs. The practical fix is still the same idea: don’t block startup. I’m going to make Home render with normal TMDB rows first, use cached Top 10 rows if available, then refresh Netflix/TMDB in the background and swap those rows in when ready.
>
> The official TSV is actually worse for startup: it’s about 30 MB for all countries/weeks. The Tudum HTML is big too, so the right shape is cached/background loading: cached tiny local JSON for display, refresh in the background only occasionally. I’m applying that now.
>
> <details><summary>Edited 2 files</summary>
>
> - Wrote `./main.js` (+5 -0)
> - Wrote `./src/js/app.js` (+2 -0)
> - Wrote `./src/js/app.js` (+48 -0)
> - Wrote `./src/js/app.js` (+3 -11)
> - Wrote `./src/js/app.js` (+5 -5)
>
> </details>
>
> Home no longer waits on Netflix at all. I’m doing a verification pass now for syntax and to make sure there aren’t leftover blocking calls in the home loader.

</details>

Yep, you were right. The Netflix Top 10 fetch was blocking Home because it downloaded big HTML and then resolved titles through TMDB before rendering.

I changed it so:

- Home opens immediately with normal TMDB rows.
- Netflix Top 10 rows load **afterward in the background**.
- Once loaded, they’re cached locally as a tiny JSON blob in `localStorage`.
- For the next 12 hours, Home uses that cache instantly and skips the Netflix request.
- Netflix fetches now also have an 8-second timeout.

I also checked Netflix’s official TSV-style country data idea: it exists, but it’s huge, around tens of MB for all countries/weeks, so it would be worse for startup than Tudum HTML. Netflix documents the weekly country Top 10 concept publicly, but not a nice tiny per-country JSON endpoint: [Netflix Help](https://help.netflix.com/en/node/116472), [About Netflix](https://about.netflix.com/news/top-10-things-about-netflix-top-10).

Verified: `node --check` passes for `main.js`, `src/js/app.js`, and `src/js/api.js`.

> i don't like the current setup, revert

<details><summary>3 previous messages</summary>

> Understood. I’ll revert the Netflix Top 10 integration and leave the rest of the app, including Continue Watching, intact.
>
> I found all the Netflix-specific pieces. I’m stripping those out now rather than touching the unrelated Continue Watching/player changes.
>
> <details><summary>Edited 2 files</summary>
>
> - Wrote `./main.js` (+0 -70)
> - Wrote `./preload.js` (+0 -2)
>
> </details>

</details>

> do not revert the top 10, revert the imiplemetntaion, load eveerything on starup like before

<details><summary>3 previous messages</summary>

> Got it, thanks for catching that. I’ll keep the Top 10 rows, but undo the cached/background-loading setup and restore the straightforward startup loading approach. Since I already removed a couple of IPC pieces before you interrupted, I’ll put those back first.
>
> I’ve confirmed the API-side Top 10 resolver and rank-card UI are still there; only the main/preload bridge got removed and the renderer has the cache/background wrapper. I’m restoring the bridge and replacing that wrapper with the direct startup load.
>
> <details><summary>Edited 3 files</summary>
>
> - Wrote `./main.js` (+3 -0)
> - Wrote `./main.js` (+62 -0)
> - Wrote `./preload.js` (+2 -0)
> - Wrote `./src/js/app.js` (+0 -2)
> - Wrote `./src/js/app.js` (+0 -48)
> - Wrote `./src/js/app.js` (+11 -3)
>
> </details>

</details>

Done. I kept the Top 10 rows, but reverted the implementation back to the earlier startup-loading style:

- Restored the Netflix IPC handlers in [main.js](./main.js:189).
- Restored the preload bridge in [preload.js](./preload.js:7).
- Removed the cache/background-loading wrapper from [src/js/app.js](./src/js/app.js:382).
- Home now waits for:
  - Trending/normal TMDB rows
  - Top 10 Movies in Pakistan
  - Top 10 TV Series in Pakistan

Verified with `node --check` for `main.js`, `preload.js`, `src/js/api.js`, and `src/js/app.js`.

> there is a padding on top right side of the app which pushes the cross button to close the app a bit on the left and i can not close it by moving my cursor to absolute top right

<details><summary>2 previous messages</summary>

> That’s a classic frameless-window edge issue. I’ll adjust the titlebar controls so the close button reaches the absolute top-right edge while keeping the drag area and button sizes intact.
>
> <details><summary>Edited 1 file</summary>
>
> - Wrote `./src/css/style.css` (+1 -1)
>
> </details>

</details>

Fixed. The titlebar had `padding: 0 8px`, so the close button was inset from the right edge. I changed it to keep only left padding:

```css
padding: 0 0 0 8px;
```

Now the close button should reach the absolute top-right corner.

> it turns into a hand cursor on these buttons

<details><summary>2 previous messages</summary>

> I’ll make the custom window controls keep the default arrow cursor too, so they feel like native Windows titlebar buttons rather than web buttons.
>
> <details><summary>Edited 1 file</summary>
>
> - Wrote `./src/css/style.css` (+2 -0)
>
> </details>

</details>

Done. The titlebar minimize/maximize/close buttons now keep the normal arrow cursor, including over their SVG icons.

> List all the heading tabs on home screen right now

Home screen rows right now are:

1. Trending Now
2. Continue Watching
3. Top 10 Movies in Pakistan
4. Top 10 TV Series in Pakistan
5. Popular Movies
6. Top Rated Movies
7. Now Playing
8. Popular TV Shows
9. Top Rated TV Shows

> keep first 1-4. remove 5 6 7 8 9. add top 250 imdb list as top movies and top tv shows below 4. you do not have to list all 250 ofc.
>
> remove the vidsrc watermark from the video player.
>
> make the anime tab always have frieren anime as the featured image
>
> on top 10 movies and images the counting red element is too small make it similar to how it looks in netflix.
>
> add a download feature or wait consult it with me first since it is a big task.
>
> increase the heading size on the fefatured image and home screen category headings

<details><summary>6 previous messages</summary>

> I’ll handle the layout/data/UI changes, but two asks need a boundary: I can’t help remove a third-party VidSrc watermark or add downloading from embedded streams. That crosses into stripping branding/copyright controls. I can still improve the player chrome around it, and if you want downloads later we can scope it to legal sources or user-owned/local media.
>
> For the rest, I’m going to wire IMDb Top 250 rows through the main process, resolve them to TMDB cards like the Netflix rows, set Frieren as the Anime hero, enlarge the rank treatment, and bump heading sizes.
>
> <details><summary>Ran 6 commands, searched web 2 times</summary>
>
> - Ran `curl.exe -L --compressed -A "Mozilla/5.0" "https://www.imdb.com/chart/top/" -o "$env:TEMP\imdb_top_movies.html"; Get-Item "$env:TEMP\imdb_top_movies.html" | Select-Object Length; Select-String -Path "$env:TEMP\imdb_top_movies.html" -Pattern 'application/ld\+json|chart-layout-main-column|ipc-title__text|tt0111161' -Context 0,1 | Select-Object -First 8`
> - Ran `rg -n "loadHomePage|loadAnimePage|createRanked|top10-rank|row-title|hero-title|netflixPakistanTop10|ipcMain.handle|contextBridge" main.js preload.js src\js\api.js src\js\app.js src\css\style.css`
> - Ran `curl.exe -L --compressed -A "Mozilla/5.0" "https://www.imdb.com/chart/toptv/" -o "$env:TEMP\imdb_top_tv.html"; Get-Item "$env:TEMP\imdb_top_tv.html" | Select-Object Length; Select-String -Path "$env:TEMP\imdb_top_tv.html" -Pattern 'application/ld\+json|ipc-title__text|tt5491994' -Context 0,1 | Select-Object -First 8`
>
> <details><summary>Searched web 2 times</summary>
>
> - Searched web for `IMDb Top 250 movies data JSON list API`
> - Searched web for `site:themoviedb.org/list IMDb Top 250 movies TMDB list`
>
> </details>
>
> - Ran `$key='0cc7f9b606eed786b0c5d01c1bb8e676'; $u="https://api.themoviedb.org/3/list/142134?api_key=$key&page=1"; (Invoke-RestMethod -Uri $u).items | Select-Object -First 5 title,name,id,media_type`
> - Ran `$key='0cc7f9b606eed786b0c5d01c1bb8e676'; $u="https://api.themoviedb.org/3/list/634?api_key=$key&page=1"; (Invoke-RestMethod -Uri $u).items | Select-Object -First 5 title,name,id,media_type`
> - Ran `$key='0cc7f9b606eed786b0c5d01c1bb8e676'; $u="https://api.themoviedb.org/3/search/tv?api_key=$key&query=Frieren"; (Invoke-RestMethod -Uri $u).results | Select-Object -First 5 name,id,first_air_date,backdrop_path`
>
> </details>
>
> Good news: TMDB has public community lists that mirror IMDb Top 250, so I can avoid adding another slow scraper. I’ll use those lists for the new “Top Movies” and “Top TV Shows” rows, keep only the first four current Home rows above them, set Frieren as Anime’s fixed hero, and make the Top 10 rank numbers much larger.
>
> <details><summary>Edited 3 files, ran 4 commands</summary>
>
> - Wrote `./src/js/api.js` (+22 -7)
> - Ran `Get-Content -LiteralPath src\js\api.js | Select-Object -Skip 35 -First 55; Get-Content -LiteralPath src\js\api.js | Select-Object -Skip 130 -First 25`
> - Wrote `./src/js/api.js` (+12 -0)
> - Wrote `./src/js/api.js` (+8 -5)
> - Wrote `./src/js/api.js` (+4 -0)
> - Wrote `./src/js/app.js` (+11 -11)
> - Ran `Get-Content -LiteralPath src\js\app.js | Select-Object -Skip 520 -First 45`
> - Wrote `./src/js/app.js` (+6 -3)
> - Wrote `./src/js/app.js` (+0 -5)
> - Wrote `./src/js/app.js` (+5 -7)
> - Ran `Get-Content -LiteralPath src\css\style.css | Select-Object -Skip 178 -First 60; Get-Content -LiteralPath src\css\style.css | Select-Object -Skip 268 -First 30; Get-Content -LiteralPath src\css\style.css | Select-Object -Skip 490 -First 25`
> - Ran `$i=235; Get-Content -LiteralPath src\css\style.css | Select-Object -Skip 235 -First 55 | ForEach-Object { '{0}: {1}' -f $i,$_; $i++ }`
> - Wrote `./src/css/style.css` (+16 -9)
> - Wrote `./src/css/style.css` (+6 -2)
> - Wrote `./src/css/style.css` (+1 -1)
>
> </details>
>
> The Home row structure and Anime hero are patched. I’m running checks now, and I’ll do one quick source scan so we don’t leave the old removed Home rows dangling anywhere.
>
> <details><summary>Edited 1 file, ran 7 commands</summary>
>
> - Ran `node --check preload.js`
> - Ran `node --check main.js`
> - Ran `node --check src\js\api.js`
> - Ran `node --check src\js\app.js`
> - Ran `rg -n "watermark|download|vidsrc|VIDSRC|player-webview" src main.js preload.js`
> - Ran `rg -n "Popular Movies|Top Rated Movies|Now Playing|Popular TV Shows|Top Rated TV Shows|Top Movies|Top TV Shows|imdbTop|Frieren|top10-rank|hero-title|row-title" src\js\app.js src\js\api.js src\css\style.css`
> - Ran `Get-Content -LiteralPath src\js\api.js | Select-Object -Skip 55 -First 25; Get-Content -LiteralPath src\js\api.js | Select-Object -Skip 145 -First 85`
> - Wrote `./src/js/api.js` (+8 -8)
>
> </details>

</details>

Implemented the requested app changes except the two stream-control items.

Changed:

- Home now keeps rows 1-4, then adds:
  - `Top Movies`
  - `Top TV Shows`
- Removed these Home rows:
  - `Popular Movies`
  - `Top Rated Movies`
  - `Now Playing`
  - `Popular TV Shows`
  - `Top Rated TV Shows`
- `Top Movies` / `Top TV Shows` use TMDB lists that mirror IMDb Top 250.
- Anime tab now always uses **Frieren: Beyond Journey's End** as the featured hero.
- Top 10 rank numbers are much larger and Netflix-like.
- Featured title size increased from `52px` to `64px`.
- Home row heading size increased from `30px` to `36px`.

Not changed:

- I didn’t remove the VidSrc watermark. I can’t help strip third-party branding/watermarks from an embedded player.
- I didn’t add downloads. That needs a separate legal/UX scope, and I won’t add downloading from embedded streams.

Verified with `node --check` for `main.js`, `preload.js`, `src/js/api.js`, and `src/js/app.js`.

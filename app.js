/**
 * AniPick - Intelligent Anime Randomizer & Discovery Engine
 * Powered by AniList GraphQL API
 */

(function () {
  'use strict';

  // ==========================================================================
  // State Management
  // ==========================================================================

  const STATE = {
    genres: [], // Master list of genres from AniList
    selectedGenres: new Set(), // Set of included genre names
    excludedGenres: new Set(), // Set of excluded genre names
    genreMatchMode: 'ANY', // 'ANY' (OR) or 'ALL' (AND)
    customTags: new Set(['Band', 'Idol', 'Isekai', 'School', 'Cyberpunk']), // User-defined or suggested custom preferences
    selectedTags: new Set(), // Set of active included custom tags
    excludedTags: new Set(), // Set of active excluded custom tags
    availableAniListTags: [], // Loaded from AniList MediaTagCollection
    currentFilters: {
      discoveryMode: 'WILDCARD', // 'WILDCARD', 'POPULARITY_DESC', 'SCORE_DESC', 'HIDDEN_GEMS', 'TRENDING_DESC'
      format: 'ANY', // 'ANY', 'TV', 'MOVIE', 'OVA_ONA', 'SPECIAL'
      minScore: 0,
      era: 'ANY', // 'ANY', '2020', '2010', '2000', '1990'
      status: 'ANY', // 'ANY', 'FINISHED', 'RELEASING'
      sfwOnly: true
    },
    activePool: [], // Fetched anime matching current filters
    seenIds: new Set(), // Set of anime IDs already displayed this session
    currentAnime: null, // The currently displayed anime object
    rollHistory: [], // Array of anime objects rolled this session
    watchlist: [], // Saved anime in localStorage
    soundEnabled: true,
    isLoading: false,
    filterSignature: '' // Hash of current filter parameters to detect changes
  };

  // Preset Collections
  const PRESETS = {
    all: { name: 'Any Genre', genres: [], tags: [] },
    shonen: { name: 'Shonen Hype', genres: ['Action', 'Adventure', 'Fantasy'], tags: [] },
    romance: { name: 'Sweet Romance', genres: ['Romance', 'Drama', 'Slice of Life'], tags: [] },
    psychological: { name: 'Mind Games & Thriller', genres: ['Psychological', 'Mystery', 'Thriller'], tags: [] },
    cozy: { name: 'Cozy Slice of Life', genres: ['Slice of Life', 'Comedy'], tags: [] },
    cyberpunk: { name: 'Sci-Fi & Mecha', genres: ['Sci-Fi', 'Mecha'], tags: ['Cyberpunk'] },
    fantasy: { name: 'Magic & Fantasy', genres: ['Fantasy', 'Supernatural', 'Adventure'], tags: [] },
    comedy: { name: 'Pure Comedy', genres: ['Comedy', 'Slice of Life'], tags: [] },
    music: { name: 'Music & Bands', genres: ['Music'], tags: ['Band'] },
    isekai: { name: 'Isekai & Fantasy', genres: ['Fantasy', 'Adventure'], tags: ['Isekai'] }
  };

  // Fallback genres if network is slow
  const FALLBACK_GENRES = [
    'Action', 'Adventure', 'Comedy', 'Drama', 'Ecchi', 'Fantasy', 
    'Horror', 'Mahou Shoujo', 'Mecha', 'Music', 'Mystery', 
    'Psychological', 'Romance', 'Sci-Fi', 'Slice of Life', 
    'Sports', 'Supernatural', 'Thriller'
  ];

  // Genre emoji icons
  const GENRE_EMOJIS = {
    'Action': '⚔️',
    'Adventure': '🧭',
    'Comedy': '😂',
    'Drama': '🎭',
    'Ecchi': '🍑',
    'Fantasy': '🔮',
    'Horror': '🩸',
    'Mahou Shoujo': '✨',
    'Mecha': '🤖',
    'Music': '🎵',
    'Mystery': '🔍',
    'Psychological': '🧠',
    'Romance': '🌸',
    'Sci-Fi': '🚀',
    'Slice of Life': '☕',
    'Sports': '⚡',
    'Supernatural': '🧿',
    'Thriller': '⚡',
    'Hentai': '🔞'
  };

  // ==========================================================================
  // Audio Synthesizer (Web Audio API)
  // ==========================================================================

  let audioCtx = null;

  function getAudioContext() {
    if (!audioCtx && (window.AudioContext || window.webkitAudioContext)) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      audioCtx = new AudioContextClass();
    }
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
    return audioCtx;
  }

  function playTickSound() {
    if (!STATE.soundEnabled) return;
    try {
      const ctx = getAudioContext();
      if (!ctx) return;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(450 + Math.random() * 150, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(180, ctx.currentTime + 0.05);

      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.05);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start();
      osc.stop(ctx.currentTime + 0.05);
    } catch (e) {}
  }

  function playFanfareSound() {
    if (!STATE.soundEnabled) return;
    try {
      const ctx = getAudioContext();
      if (!ctx) return;

      const notes = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6
      notes.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, ctx.currentTime + idx * 0.08);

        gain.gain.setValueAtTime(0, ctx.currentTime + idx * 0.08);
        gain.gain.linearRampToValueAtTime(0.12, ctx.currentTime + idx * 0.08 + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + idx * 0.08 + 0.35);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(ctx.currentTime + idx * 0.08);
        osc.stop(ctx.currentTime + idx * 0.08 + 0.35);
      });
    } catch (e) {}
  }

  // ==========================================================================
  // AniList GraphQL Client
  // ==========================================================================

  const ANILIST_URL = 'https://graphql.anilist.co';

  async function fetchAniList(query, variables = {}) {
    const response = await fetch(ANILIST_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({ query, variables })
    });

    if (!response.ok) {
      if (response.status === 429) {
        throw new Error('AniList rate limit reached. Please wait a few moments.');
      }
      const errJson = await response.json().catch(() => null);
      const msg = errJson?.errors?.[0]?.message || `AniList Error: ${response.statusText}`;
      throw new Error(msg);
    }

    const json = await response.json();
    return json.data;
  }

  // Fetch Master Genre Collection & Media Tag Collection
  async function loadGenresAndTags() {
    try {
      const query = `query { 
        GenreCollection 
        MediaTagCollection { 
          name 
          category 
          isAdult 
        } 
      }`;
      const data = await fetchAniList(query);
      if (data && data.GenreCollection) {
        STATE.genres = data.GenreCollection.filter(g => g !== 'Hentai');
      } else {
        STATE.genres = FALLBACK_GENRES;
      }

      if (data && data.MediaTagCollection) {
        STATE.availableAniListTags = data.MediaTagCollection
          .filter(t => !t.isAdult)
          .map(t => t.name)
          .sort();
        populateTagsDatalist();
      }
    } catch (err) {
      console.warn('Could not load genres/tags dynamically, using fallback', err);
      STATE.genres = FALLBACK_GENRES;
    }
    renderGenreChips();
    renderCustomTags();
  }

  function populateTagsDatalist() {
    const datalist = document.getElementById('anilist-tags-datalist');
    if (!datalist) return;
    datalist.innerHTML = '';
    STATE.availableAniListTags.slice(0, 350).forEach(tagName => {
      const opt = document.createElement('option');
      opt.value = tagName;
      datalist.appendChild(opt);
    });
  }

  // ==========================================================================
  // Query Construction & Randomizer Logic
  // ==========================================================================

  function computeFilterSignature() {
    const genres = Array.from(STATE.selectedGenres).sort().join(',');
    const excluded = Array.from(STATE.excludedGenres).sort().join(',');
    const tags = Array.from(STATE.selectedTags).sort().join(',');
    const excludedTags = Array.from(STATE.excludedTags).sort().join(',');
    const { discoveryMode, format, minScore, era, status, sfwOnly } = STATE.currentFilters;
    return `${genres}|${excluded}|${tags}|${excludedTags}|${STATE.genreMatchMode}|${discoveryMode}|${format}|${minScore}|${era}|${status}|${sfwOnly}`;
  }

  function buildGraphQLParams(page = 1, perPage = 25) {
    const variables = {
      page: page,
      perPage: perPage,
      isAdult: !STATE.currentFilters.sfwOnly ? undefined : false
    };

    // Genres inclusion & exclusion
    if (STATE.selectedGenres.size > 0) {
      variables.genres = Array.from(STATE.selectedGenres);
    }
    if (STATE.excludedGenres.size > 0) {
      variables.excludedGenres = Array.from(STATE.excludedGenres);
    }

    // Custom Tags inclusion & exclusion
    if (STATE.selectedTags.size > 0) {
      variables.tags = Array.from(STATE.selectedTags);
    }
    if (STATE.excludedTags.size > 0) {
      variables.excludedTags = Array.from(STATE.excludedTags);
    }

    // Format mapping
    if (STATE.currentFilters.format !== 'ANY') {
      if (STATE.currentFilters.format === 'OVA_ONA') {
        variables.format_in = ['OVA', 'ONA'];
      } else {
        variables.format_in = [STATE.currentFilters.format];
      }
    }

    // Status mapping
    if (STATE.currentFilters.status !== 'ANY') {
      variables.status = STATE.currentFilters.status;
    }

    // Minimum score
    if (STATE.currentFilters.minScore > 0) {
      variables.minScore = STATE.currentFilters.minScore;
    }

    // Era date range
    if (STATE.currentFilters.era !== 'ANY') {
      const era = parseInt(STATE.currentFilters.era, 10);
      if (era === 2020) {
        variables.startDate_greater = 20200101;
      } else if (era === 2010) {
        variables.startDate_greater = 20100101;
        variables.startDate_lesser = 20191231;
      } else if (era === 2000) {
        variables.startDate_greater = 20000101;
        variables.startDate_lesser = 20091231;
      } else if (era === 1990) {
        variables.startDate_lesser = 19991231;
      }
    }

    // Sort order & discovery strategy
    const mode = STATE.currentFilters.discoveryMode;
    if (mode === 'POPULARITY_DESC') {
      variables.sort = ['POPULARITY_DESC'];
    } else if (mode === 'SCORE_DESC') {
      variables.sort = ['SCORE_DESC'];
    } else if (mode === 'TRENDING_DESC') {
      variables.sort = ['TRENDING_DESC'];
    } else if (mode === 'HIDDEN_GEMS') {
      variables.sort = ['SCORE_DESC'];
      if (!variables.minScore) {
        variables.minScore = 75; // Baseline high rating for hidden gems
      }
    } else {
      // WILDCARD
      variables.sort = ['POPULARITY_DESC'];
    }

    return variables;
  }

  const MEDIA_QUERY = `
    query (
      $page: Int,
      $perPage: Int,
      $genres: [String],
      $excludedGenres: [String],
      $tags: [String],
      $excludedTags: [String],
      $format_in: [MediaFormat],
      $status: MediaStatus,
      $minScore: Int,
      $startDate_greater: FuzzyDateInt,
      $startDate_lesser: FuzzyDateInt,
      $sort: [MediaSort],
      $isAdult: Boolean
    ) {
      Page(page: $page, perPage: $perPage) {
        pageInfo {
          total
          currentPage
          lastPage
          hasNextPage
        }
        media(
          type: ANIME,
          genre_in: $genres,
          genre_not_in: $excludedGenres,
          tag_in: $tags,
          tag_not_in: $excludedTags,
          format_in: $format_in,
          status: $status,
          averageScore_greater: $minScore,
          startDate_greater: $startDate_greater,
          startDate_lesser: $startDate_lesser,
          sort: $sort,
          isAdult: $isAdult
        ) {
          id
          title {
            romaji
            english
            native
          }
          coverImage {
            extraLarge
            large
            medium
            color
          }
          bannerImage
          description(asHtml: false)
          genres
          tags {
            name
            rank
          }
          format
          episodes
          duration
          status
          season
          seasonYear
          averageScore
          popularity
          favourites
          studios(isMain: true) {
            nodes {
              name
            }
          }
          siteUrl
          trailer {
            id
            site
          }
          nextAiringEpisode {
            airingAt
            timeUntilAiring
            episode
          }
        }
      }
    }
  `;

  async function fetchAnimePool() {
    const variables = buildGraphQLParams(1, 25);
    const data = await fetchAniList(MEDIA_QUERY, variables);

    if (!data?.Page?.media || data.Page.media.length === 0) {
      return { total: 0, items: [] };
    }

    const pageInfo = data.Page.pageInfo;
    let pool = [...data.Page.media];

    // If WILDCARD mode and multiple pages exist, pick a random page to inject deep cuts
    if (STATE.currentFilters.discoveryMode === 'WILDCARD' && pageInfo.lastPage > 1) {
      const maxRandomPage = Math.min(pageInfo.lastPage, 25);
      const randomPage = Math.floor(Math.random() * maxRandomPage) + 1;
      if (randomPage !== 1) {
        try {
          const deepVars = buildGraphQLParams(randomPage, 25);
          const deepData = await fetchAniList(MEDIA_QUERY, deepVars);
          if (deepData?.Page?.media && deepData.Page.media.length > 0) {
            pool = deepData.Page.media;
          }
        } catch (e) {
          // If deep page fetch fails, fallback to page 1 pool
        }
      }
    } else if (STATE.currentFilters.discoveryMode === 'HIDDEN_GEMS' && pageInfo.lastPage > 3) {
      // Pick lower popularity pages (e.g., page 3-12) with high score
      const randomPage = Math.min(pageInfo.lastPage, Math.floor(Math.random() * 8) + 3);
      try {
        const gemVars = buildGraphQLParams(randomPage, 25);
        const gemData = await fetchAniList(MEDIA_QUERY, gemVars);
        if (gemData?.Page?.media?.length > 0) {
          pool = gemData.Page.media;
        }
      } catch (e) {}
    }

    // Filter for "ALL (AND)" genres and tags mode if requested
    if (STATE.genreMatchMode === 'ALL') {
      if (STATE.selectedGenres.size > 0) {
        const requiredGenres = Array.from(STATE.selectedGenres);
        pool = pool.filter(anime => {
          const itemGenres = anime.genres || [];
          return requiredGenres.every(req => itemGenres.includes(req));
        });
      }
      if (STATE.selectedTags.size > 0) {
        const requiredTags = Array.from(STATE.selectedTags).map(t => t.toLowerCase());
        pool = pool.filter(anime => {
          const itemTags = (anime.tags || []).map(t => (t.name || '').toLowerCase());
          return requiredTags.every(t => itemTags.includes(t));
        });
      }
    }

    return { total: pageInfo.total, items: pool };
  }

  // Master Randomizer Entrypoint
  async function rollRandomAnime() {
    if (STATE.isLoading) return;

    const newSig = computeFilterSignature();
    const filterChanged = newSig !== STATE.filterSignature;

    if (filterChanged) {
      STATE.filterSignature = newSig;
      STATE.activePool = [];
    }

    setLoading(true);

    try {
      // Check if we need to replenish the pool
      let candidates = STATE.activePool.filter(a => !STATE.seenIds.has(a.id));

      if (candidates.length === 0) {
        updateCatalogStatus('Searching AniList catalog...');
        const result = await fetchAnimePool();

        if (!result.items || result.items.length === 0) {
          showErrorState(
            'No Anime Found',
            'No titles matched your specific filter combination. Try selecting fewer tags/genres or lowering the minimum score.'
          );
          setLoading(false);
          return;
        }

        STATE.activePool = result.items;
        candidates = STATE.activePool.filter(a => !STATE.seenIds.has(a.id));

        // If all candidates in current pool were seen, reset seen IDs for this pool to loop seamlessly
        if (candidates.length === 0) {
          candidates = [...STATE.activePool];
        }

        updateCatalogStatus(`Discovered ${result.total.toLocaleString()} anime in this pool`);
      }

      // Pick random anime
      const randomIndex = Math.floor(Math.random() * candidates.length);
      const chosen = candidates[randomIndex];
      STATE.seenIds.add(chosen.id);

      // Run Roulette / Slot-Machine Ticker Animation
      await runRouletteAnimation(candidates, chosen);

      // Reveal Chosen Anime
      displayAnime(chosen);
      addToHistory(chosen);
      playFanfareSound();

    } catch (err) {
      console.error(err);
      showErrorState('Error Connecting to AniList', err.message || 'Unable to fetch recommendations right now.');
    } finally {
      setLoading(false);
    }
  }

  // Slot machine animation effect
  async function runRouletteAnimation(samplePool, winner) {
    const ticker = document.getElementById('slot-ticker');
    const tickerTitle = document.getElementById('ticker-preview-title');
    const card = document.getElementById('anime-card');
    const emptyView = document.getElementById('empty-state-view');

    card.classList.add('hidden');
    emptyView.classList.add('hidden');
    ticker.classList.remove('hidden');

    const previewTitles = samplePool.map(a => a.title.english || a.title.romaji).filter(Boolean);
    if (previewTitles.length === 0) {
      previewTitles.push(winner.title.english || winner.title.romaji);
    }

    // Cycle through 8 rapid preview steps with audio ticks
    const steps = 8;
    for (let i = 0; i < steps; i++) {
      const sample = previewTitles[i % previewTitles.length];
      tickerTitle.textContent = sample;
      playTickSound();
      const delay = 60 + i * 25; // Gradual slowdown
      await new Promise(r => setTimeout(r, delay));
    }

    ticker.classList.add('hidden');
  }

  // ==========================================================================
  // Display & UI Rendering
  // ==========================================================================

  function displayAnime(anime) {
    STATE.currentAnime = anime;

    const emptyView = document.getElementById('empty-state-view');
    const errorNotice = document.getElementById('error-notice');
    const card = document.getElementById('anime-card');

    emptyView.classList.add('hidden');
    errorNotice.classList.add('hidden');
    card.classList.remove('hidden');

    // Banner image & color tint
    const bannerImg = document.getElementById('card-banner-img');
    const colorTint = document.getElementById('banner-color-tint');
    const coverColor = anime.coverImage?.color || '#8b5cf6';

    const bannerUrl = anime.bannerImage || anime.coverImage?.extraLarge || anime.coverImage?.large;
    bannerImg.src = bannerUrl;
    bannerImg.alt = `${anime.title.romaji} Banner`;
    colorTint.style.backgroundColor = coverColor;

    // Poster & Format
    const posterImg = document.getElementById('poster-img');
    posterImg.src = anime.coverImage?.extraLarge || anime.coverImage?.large || '';
    posterImg.alt = `${anime.title.romaji} Poster`;

    const formatBadge = document.getElementById('poster-format-badge');
    const formatName = formatFormatName(anime.format);
    formatBadge.textContent = formatName;

    // Score radial
    const scoreVal = document.getElementById('score-val');
    const ringFill = document.getElementById('score-ring-fill');
    const score = anime.averageScore;

    if (score) {
      scoreVal.textContent = `${score}%`;
      ringFill.setAttribute('stroke-dasharray', `${score}, 100`);
      if (score >= 80) {
        ringFill.setAttribute('stroke', '#10b981'); // Emerald
      } else if (score >= 70) {
        ringFill.setAttribute('stroke', '#38bdf8'); // Sky Blue
      } else if (score >= 60) {
        ringFill.setAttribute('stroke', '#f59e0b'); // Amber
      } else {
        ringFill.setAttribute('stroke', '#f43f5e'); // Rose
      }
    } else {
      scoreVal.textContent = 'N/A';
      ringFill.setAttribute('stroke-dasharray', `0, 100`);
    }

    // Titles
    const enTitle = anime.title.english || anime.title.romaji;
    document.getElementById('anime-title-en').textContent = enTitle;

    const romajiElem = document.getElementById('anime-title-romaji');
    if (anime.title.english && anime.title.romaji && anime.title.english !== anime.title.romaji) {
      romajiElem.textContent = anime.title.romaji;
      romajiElem.classList.remove('hidden');
    } else {
      romajiElem.classList.add('hidden');
    }

    const nativeElem = document.getElementById('anime-title-native');
    if (anime.title.native) {
      nativeElem.textContent = anime.title.native;
      nativeElem.classList.remove('hidden');
    } else {
      nativeElem.classList.add('hidden');
    }

    // Metadata Pills
    const metaYear = document.getElementById('meta-year');
    metaYear.textContent = anime.seasonYear || (anime.season ? `${anime.season}` : 'Unknown Year');

    const metaEpisodes = document.getElementById('meta-episodes');
    if (anime.episodes) {
      metaEpisodes.textContent = `${anime.episodes} ${anime.episodes === 1 ? 'Episode' : 'Episodes'}${anime.duration ? ` (${anime.duration}m)` : ''}`;
      metaEpisodes.classList.remove('hidden');
    } else {
      metaEpisodes.classList.add('hidden');
    }

    const metaStatus = document.getElementById('meta-status');
    metaStatus.textContent = anime.status ? anime.status.replace(/_/g, ' ') : 'Finished';

    const metaStudio = document.getElementById('meta-studio');
    const studioName = anime.studios?.nodes?.[0]?.name;
    if (studioName) {
      metaStudio.textContent = studioName;
      metaStudio.classList.remove('hidden');
    } else {
      metaStudio.classList.add('hidden');
    }

    // Genres & Tags Wrap
    const genresWrap = document.getElementById('card-genres-list');
    genresWrap.innerHTML = '';
    (anime.genres || []).forEach(genre => {
      const pill = document.createElement('button');
      pill.type = 'button';
      pill.className = 'card-genre-pill';
      pill.textContent = `${GENRE_EMOJIS[genre] || '🏷️'} ${genre}`;
      pill.title = `Click to filter by ${genre}`;
      pill.addEventListener('click', () => {
        STATE.selectedGenres.clear();
        STATE.selectedGenres.add(genre);
        renderGenreChips();
        rollRandomAnime();
        showToast(`Filtered for ${genre}`, 'info');
      });
      genresWrap.appendChild(pill);
    });

    // Add up to 3 notable tags to card
    (anime.tags || []).slice(0, 3).forEach(tag => {
      const pill = document.createElement('button');
      pill.type = 'button';
      pill.className = 'card-genre-pill';
      pill.style.borderColor = 'rgba(6, 182, 212, 0.4)';
      pill.style.color = '#67e8f9';
      pill.textContent = `#${tag.name}`;
      pill.title = `Click to add tag filter: ${tag.name}`;
      pill.addEventListener('click', () => {
        addCustomTag(tag.name);
        rollRandomAnime();
      });
      genresWrap.appendChild(pill);
    });

    // Synopsis with cleaner text
    const synopsisElem = document.getElementById('anime-synopsis');
    const expandBtn = document.getElementById('expand-synopsis-btn');
    const cleanDesc = sanitizeSynopsis(anime.description || 'No synopsis provided for this anime.');
    synopsisElem.innerHTML = cleanDesc;

    if (cleanDesc.length > 250) {
      synopsisElem.classList.add('collapsed');
      expandBtn.classList.remove('hidden');
      expandBtn.textContent = 'Read More';
    } else {
      synopsisElem.classList.remove('collapsed');
      expandBtn.classList.add('hidden');
    }

    // Airing notification
    const airingAlert = document.getElementById('airing-alert');
    if (anime.nextAiringEpisode) {
      const nextEp = anime.nextAiringEpisode;
      const days = Math.floor(nextEp.timeUntilAiring / (3600 * 24));
      const hours = Math.floor((nextEp.timeUntilAiring % (3600 * 24)) / 3600);
      let timeStr = `${days}d ${hours}h`;
      if (days === 0) timeStr = `${hours}h`;
      document.getElementById('airing-alert-text').textContent = `Episode ${nextEp.episode} airs in ~${timeStr}`;
      airingAlert.classList.remove('hidden');
    } else {
      airingAlert.classList.add('hidden');
    }

    // Watchlist state on card button
    updateWatchlistButtonState();

    // Trailer Button: Always accessible with smart Watch or Search mode
    const trailerBtn = document.getElementById('watch-trailer-btn');
    const hasOfficialTrailer = Boolean(anime.trailer && anime.trailer.id && (anime.trailer.site === 'youtube' || anime.trailer.site === 'dailymotion'));
    trailerBtn.classList.remove('hidden');
    if (hasOfficialTrailer) {
      trailerBtn.innerHTML = `
        <svg viewBox="0 0 24 24" fill="currentColor">
          <polygon points="5 3 19 12 5 21 5 3"></polygon>
        </svg>
        <span>Watch Trailer</span>
      `;
      trailerBtn.title = 'Watch official trailer';
    } else {
      trailerBtn.innerHTML = `
        <svg viewBox="0 0 24 24" fill="currentColor">
          <polygon points="5 3 19 12 5 21 5 3"></polygon>
        </svg>
        <span>Find Trailer</span>
      `;
      trailerBtn.title = 'Search official trailer on YouTube';
    }

    // AniList link
    const anilistLink = document.getElementById('anilist-link-btn');
    anilistLink.href = anime.siteUrl || `https://anilist.co/anime/${anime.id}`;

    // Scroll smoothly to show card on mobile if needed
    if (window.innerWidth <= 768) {
      card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  function formatFormatName(format) {
    switch (format) {
      case 'TV': return 'TV Series';
      case 'TV_SHORT': return 'TV Short';
      case 'MOVIE': return 'Movie';
      case 'SPECIAL': return 'Special';
      case 'OVA': return 'OVA';
      case 'ONA': return 'ONA Web';
      case 'MUSIC': return 'Music Video';
      default: return format || 'Anime';
    }
  }

  function sanitizeSynopsis(html) {
    if (!html) return '';
    return html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/?i>/gi, '')
      .replace(/<\/?b>/gi, '')
      .replace(/<\/?strong>/gi, '')
      .replace(/<\/?em>/gi, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function updateCatalogStatus(text) {
    document.getElementById('catalog-status-text').textContent = text;
  }

  function setLoading(loading) {
    STATE.isLoading = loading;
    const rollBtn = document.getElementById('roll-anime-btn');
    const surpriseBtn = document.getElementById('surprise-me-btn');
    const btnText = document.getElementById('roll-btn-text');

    rollBtn.disabled = loading;
    surpriseBtn.disabled = loading;

    if (loading) {
      btnText.textContent = 'Rolling Random Anime...';
    } else {
      btnText.textContent = 'Roll Random Anime';
    }
  }

  function showErrorState(title, detail) {
    const errorNotice = document.getElementById('error-notice');
    const emptyView = document.getElementById('empty-state-view');
    const card = document.getElementById('anime-card');

    card.classList.add('hidden');
    emptyView.classList.add('hidden');
    errorNotice.classList.remove('hidden');

    document.getElementById('error-heading').textContent = title;
    document.getElementById('error-detail').textContent = detail;
  }

  // ==========================================================================
  // Genre Pills Interaction
  // ==========================================================================

  function renderGenreChips() {
    const grid = document.getElementById('genre-chip-grid');
    grid.innerHTML = '';

    STATE.genres.forEach(genre => {
      const badge = document.createElement('button');
      badge.type = 'button';
      badge.className = 'genre-badge';
      badge.dataset.genre = genre;

      const isIncluded = STATE.selectedGenres.has(genre);
      const isExcluded = STATE.excludedGenres.has(genre);

      let symbol = '+';
      if (isIncluded) {
        badge.classList.add('included');
        symbol = '✓';
      } else if (isExcluded) {
        badge.classList.add('excluded');
        symbol = '✕';
      }

      badge.innerHTML = `
        <span class="badge-emoji">${GENRE_EMOJIS[genre] || '🏷️'}</span>
        <span class="badge-name">${genre}</span>
        <span class="badge-symbol">${symbol}</span>
      `;

      // Click: Normal toggle (Neutral <-> Included) or if Shift key is pressed, toggle Excluded
      badge.addEventListener('click', (e) => {
        if (e.shiftKey) {
          toggleGenreExclude(genre);
        } else {
          toggleGenreInclude(genre);
        }
      });

      // Right-click: Toggle Excluded state
      badge.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        toggleGenreExclude(genre);
      });

      grid.appendChild(badge);
    });

    updateGenreHint();
  }

  function toggleGenreInclude(genre) {
    if (STATE.excludedGenres.has(genre)) {
      STATE.excludedGenres.delete(genre);
    }

    if (STATE.selectedGenres.has(genre)) {
      STATE.selectedGenres.delete(genre);
    } else {
      STATE.selectedGenres.add(genre);
    }

    renderGenreChips();
  }

  function toggleGenreExclude(genre) {
    if (STATE.selectedGenres.has(genre)) {
      STATE.selectedGenres.delete(genre);
    }

    if (STATE.excludedGenres.has(genre)) {
      STATE.excludedGenres.delete(genre);
    } else {
      STATE.excludedGenres.add(genre);
    }

    renderGenreChips();
    showToast(`Excluded ${genre} from results`, 'info');
  }

  function updateGenreHint() {
    const hint = document.getElementById('genre-hint-count');
    const incCount = STATE.selectedGenres.size;
    const excCount = STATE.excludedGenres.size;

    if (incCount === 0 && excCount === 0) {
      hint.textContent = 'All genres (broad discovery)';
    } else if (excCount > 0) {
      hint.textContent = `${incCount} included, ${excCount} excluded`;
    } else {
      hint.textContent = `${incCount} selected`;
    }
  }

  // ==========================================================================
  // Custom Tags & User Preferences Management
  // ==========================================================================

  const CUSTOM_TAGS_STORAGE_KEY = 'anipick_custom_tags_v1';

  function loadCustomTagsFromStorage() {
    try {
      const saved = localStorage.getItem(CUSTOM_TAGS_STORAGE_KEY);
      if (saved) {
        const arr = JSON.parse(saved);
        if (Array.isArray(arr) && arr.length > 0) {
          STATE.customTags = new Set(arr);
        }
      }
    } catch (e) {}
  }

  function saveCustomTagsToStorage() {
    try {
      localStorage.setItem(CUSTOM_TAGS_STORAGE_KEY, JSON.stringify(Array.from(STATE.customTags)));
    } catch (e) {}
  }

  function addCustomTag(name) {
    const trimmed = (name || '').trim();
    if (!trimmed) return;

    // Check if user typed an official AniList Genre
    const matchGenre = STATE.genres.find(g => g.toLowerCase() === trimmed.toLowerCase());
    if (matchGenre) {
      STATE.selectedGenres.add(matchGenre);
      renderGenreChips();
      showToast(`Selected official genre: ${matchGenre}`, 'success');
      return;
    }

    // Check if matches an official AniList tag
    const matchTag = STATE.availableAniListTags.find(t => t.toLowerCase() === trimmed.toLowerCase()) || trimmed;

    STATE.customTags.add(matchTag);
    STATE.selectedTags.add(matchTag);
    saveCustomTagsToStorage();
    renderCustomTags();
    showToast(`Added custom preference: ${matchTag}`, 'success');
  }

  function removeCustomTag(tag) {
    STATE.customTags.delete(tag);
    STATE.selectedTags.delete(tag);
    STATE.excludedTags.delete(tag);
    saveCustomTagsToStorage();
    renderCustomTags();
    showToast(`Removed preference: ${tag}`, 'info');
  }

  function renderCustomTags() {
    const grid = document.getElementById('custom-chip-grid');
    if (!grid) return;
    grid.innerHTML = '';

    STATE.customTags.forEach(tag => {
      const badge = document.createElement('div');
      badge.className = 'custom-tag-badge';

      const isIncluded = STATE.selectedTags.has(tag);
      const isExcluded = STATE.excludedTags.has(tag);

      let symbol = '+';
      if (isIncluded) {
        badge.classList.add('included');
        symbol = '✓';
      } else if (isExcluded) {
        badge.classList.add('excluded');
        symbol = '✕';
      }

      badge.innerHTML = `
        <span class="custom-badge-emoji">🏷️</span>
        <span class="custom-badge-name">${tag}</span>
        <span class="badge-symbol">${symbol}</span>
        <button type="button" class="btn-remove-tag" title="Remove this preference" data-tag="${tag}">×</button>
      `;

      badge.addEventListener('click', (e) => {
        if (e.target.classList.contains('btn-remove-tag')) return;
        if (e.shiftKey) {
          toggleTagExclude(tag);
        } else {
          toggleTagInclude(tag);
        }
      });

      badge.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        toggleTagExclude(tag);
      });

      badge.querySelector('.btn-remove-tag').addEventListener('click', (e) => {
        e.stopPropagation();
        removeCustomTag(tag);
      });

      grid.appendChild(badge);
    });

    updateCustomTagsHint();
  }

  function toggleTagInclude(tag) {
    if (STATE.excludedTags.has(tag)) {
      STATE.excludedTags.delete(tag);
    }
    if (STATE.selectedTags.has(tag)) {
      STATE.selectedTags.delete(tag);
    } else {
      STATE.selectedTags.add(tag);
    }
    renderCustomTags();
  }

  function toggleTagExclude(tag) {
    if (STATE.selectedTags.has(tag)) {
      STATE.selectedTags.delete(tag);
    }
    if (STATE.excludedTags.has(tag)) {
      STATE.excludedTags.delete(tag);
    } else {
      STATE.excludedTags.add(tag);
    }
    renderCustomTags();
    showToast(`Excluded tag: ${tag}`, 'info');
  }

  function updateCustomTagsHint() {
    const hint = document.getElementById('custom-tags-hint');
    if (!hint) return;
    const inc = STATE.selectedTags.size;
    const exc = STATE.excludedTags.size;
    if (inc === 0 && exc === 0) {
      hint.textContent = `${STATE.customTags.size} available`;
    } else if (exc > 0) {
      hint.textContent = `${inc} active, ${exc} excluded`;
    } else {
      hint.textContent = `${inc} active`;
    }
  }

  // ==========================================================================
  // Presets & Filter Deck Controls
  // ==========================================================================

  function applyPreset(presetKey) {
    const preset = PRESETS[presetKey];
    if (!preset) return;

    STATE.selectedGenres.clear();
    STATE.excludedGenres.clear();
    STATE.selectedTags.clear();
    STATE.excludedTags.clear();

    preset.genres.forEach(g => STATE.selectedGenres.add(g));
    if (preset.tags) {
      preset.tags.forEach(t => {
        STATE.customTags.add(t);
        STATE.selectedTags.add(t);
      });
      renderCustomTags();
    }
    renderGenreChips();

    // Highlight active preset button
    document.querySelectorAll('.preset-chip').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.preset === presetKey);
    });

    showToast(`Preset loaded: ${preset.name}`, 'info');
  }

  function resetAllFilters() {
    STATE.selectedGenres.clear();
    STATE.excludedGenres.clear();
    STATE.selectedTags.clear();
    STATE.excludedTags.clear();
    STATE.genreMatchMode = 'ANY';

    STATE.currentFilters = {
      discoveryMode: 'WILDCARD',
      format: 'ANY',
      minScore: 0,
      era: 'ANY',
      status: 'ANY',
      sfwOnly: true
    };

    // Reset Form DOM elements
    document.getElementById('filter-mode').value = 'WILDCARD';
    document.getElementById('filter-format').value = 'ANY';
    document.getElementById('filter-score').value = 0;
    document.getElementById('score-display').textContent = 'Any Score';
    document.getElementById('filter-era').value = 'ANY';
    document.getElementById('filter-status').value = 'ANY';
    document.getElementById('sfw-only-checkbox').checked = true;

    document.getElementById('mode-any-btn').classList.add('active');
    document.getElementById('mode-all-btn').classList.remove('active');

    // Preset chips
    document.querySelectorAll('.preset-chip').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.preset === 'all');
    });

    renderGenreChips();
    renderCustomTags();
    updateCatalogStatus('Filters reset. Ready to roll!');
    showToast('All filters have been reset', 'info');
  }

  // ==========================================================================
  // Watchlist & History Management
  // ==========================================================================

  const WATCHLIST_STORAGE_KEY = 'anipick_watchlist_v1';
  const HISTORY_STORAGE_KEY = 'anipick_history_v1';

  function loadSavedData() {
    try {
      const savedWatchlist = localStorage.getItem(WATCHLIST_STORAGE_KEY);
      if (savedWatchlist) {
        STATE.watchlist = JSON.parse(savedWatchlist);
      }
      const savedHistory = localStorage.getItem(HISTORY_STORAGE_KEY);
      if (savedHistory) {
        STATE.rollHistory = JSON.parse(savedHistory);
      }
    } catch (e) {
      console.warn('Could not read from localStorage', e);
    }
    loadCustomTagsFromStorage();
    updateWatchlistBadge();
    updateHistoryBadge();
    renderRecentReel();
  }

  function saveWatchlist() {
    try {
      localStorage.setItem(WATCHLIST_STORAGE_KEY, JSON.stringify(STATE.watchlist));
    } catch (e) {}
    updateWatchlistBadge();
    updateWatchlistButtonState();
  }

  function saveHistory() {
    try {
      // Limit saved history to last 50 items
      const trimmed = STATE.rollHistory.slice(0, 50);
      localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(trimmed));
    } catch (e) {}
    updateHistoryBadge();
    renderRecentReel();
  }

  function toggleWatchlistCurrentAnime() {
    if (!STATE.currentAnime) return;
    const anime = STATE.currentAnime;
    const existingIndex = STATE.watchlist.findIndex(item => item.id === anime.id);

    if (existingIndex >= 0) {
      STATE.watchlist.splice(existingIndex, 1);
      showToast('Removed from Watchlist', 'info');
    } else {
      STATE.watchlist.unshift({
        id: anime.id,
        title: anime.title,
        coverImage: anime.coverImage,
        format: anime.format,
        averageScore: anime.averageScore,
        genres: anime.genres,
        siteUrl: anime.siteUrl,
        savedAt: Date.now()
      });
      showToast('Saved to Watchlist!', 'success');
    }

    saveWatchlist();
  }

  function updateWatchlistButtonState() {
    const btn = document.getElementById('toggle-watchlist-btn');
    const text = document.getElementById('watchlist-btn-text');
    if (!STATE.currentAnime) return;

    const isSaved = STATE.watchlist.some(item => item.id === STATE.currentAnime.id);
    if (isSaved) {
      btn.classList.add('saved');
      text.textContent = 'Saved to Watchlist';
    } else {
      btn.classList.remove('saved');
      text.textContent = 'Add to Watchlist';
    }
  }

  function updateWatchlistBadge() {
    const count = STATE.watchlist.length;
    document.getElementById('watchlist-count').textContent = count;
    document.getElementById('modal-watchlist-count').textContent = count;
  }

  function addToHistory(anime) {
    if (STATE.rollHistory.length > 0 && STATE.rollHistory[0].id === anime.id) {
      return;
    }
    STATE.rollHistory.unshift(anime);
    saveHistory();
  }

  function updateHistoryBadge() {
    const count = STATE.rollHistory.length;
    document.getElementById('history-count').textContent = count;
    document.getElementById('modal-history-count').textContent = count;
  }

  function renderRecentReel() {
    const section = document.getElementById('recent-reel-section');
    const strip = document.getElementById('recent-strip');

    if (STATE.rollHistory.length <= 1) {
      section.classList.add('hidden');
      return;
    }

    section.classList.remove('hidden');
    strip.innerHTML = '';

    // Show previous rolls (excluding current)
    const recentItems = STATE.rollHistory.slice(1, 15);
    recentItems.forEach(item => {
      const thumb = document.createElement('div');
      thumb.className = 'recent-thumb-card';
      thumb.title = item.title.english || item.title.romaji;

      thumb.innerHTML = `
        <img class="recent-thumb-img" src="${item.coverImage?.medium || item.coverImage?.large}" alt="${item.title.romaji}" loading="lazy">
        ${item.averageScore ? `<div class="recent-thumb-score">${item.averageScore}%</div>` : ''}
        <div class="recent-thumb-title">${item.title.english || item.title.romaji}</div>
      `;

      thumb.addEventListener('click', () => {
        displayAnime(item);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });

      strip.appendChild(thumb);
    });
  }

  // Render Watchlist Modal List
  function renderWatchlistModal() {
    const list = document.getElementById('watchlist-items-list');
    const filterQuery = (document.getElementById('watchlist-search-input').value || '').toLowerCase().trim();

    list.innerHTML = '';

    const filtered = STATE.watchlist.filter(item => {
      if (!filterQuery) return true;
      const title = (item.title.english || item.title.romaji || '').toLowerCase();
      return title.includes(filterQuery);
    });

    if (filtered.length === 0) {
      list.innerHTML = `
        <div style="text-align:center; padding: 2.5rem 1rem; color: var(--text-muted);">
          ${filterQuery ? 'No saved anime matches your search.' : 'Your watchlist is empty! Roll some anime and save them here.'}
        </div>
      `;
      return;
    }

    filtered.forEach(item => {
      const row = document.createElement('div');
      row.className = 'watchlist-item';

      const title = item.title.english || item.title.romaji;
      const format = formatFormatName(item.format);

      row.innerHTML = `
        <img class="watchlist-thumb" src="${item.coverImage?.medium || item.coverImage?.large}" alt="${title}">
        <div class="watchlist-details">
          <div class="watchlist-title" title="${title}">${title}</div>
          <div class="watchlist-meta">${format} • ${item.averageScore ? `${item.averageScore}% Score` : 'No score'}</div>
        </div>
        <div class="watchlist-actions">
          <a href="${item.siteUrl || `https://anilist.co/anime/${item.id}`}" target="_blank" rel="noopener noreferrer" class="mini-btn" title="View on AniList">
            Link ↗
          </a>
          <button type="button" class="mini-btn danger-btn remove-saved-btn" title="Remove from watchlist" data-id="${item.id}">
            ✕
          </button>
        </div>
      `;

      row.querySelector('.watchlist-details').addEventListener('click', () => {
        displayAnime(item);
        closeModal('watchlist-modal');
      });

      row.querySelector('.remove-saved-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        STATE.watchlist = STATE.watchlist.filter(w => w.id !== item.id);
        saveWatchlist();
        renderWatchlistModal();
      });

      list.appendChild(row);
    });
  }

  // Render History Modal List
  function renderHistoryModal() {
    const list = document.getElementById('history-items-list');
    list.innerHTML = '';

    if (STATE.rollHistory.length === 0) {
      list.innerHTML = `
        <div style="text-align:center; padding: 2.5rem 1rem; color: var(--text-muted);">
          No rolls recorded yet this session. Click Roll Anime to begin!
        </div>
      `;
      return;
    }

    STATE.rollHistory.forEach(item => {
      const row = document.createElement('div');
      row.className = 'history-item';

      const title = item.title.english || item.title.romaji;
      const format = formatFormatName(item.format);

      row.innerHTML = `
        <img class="history-thumb" src="${item.coverImage?.medium || item.coverImage?.large}" alt="${title}">
        <div class="history-details">
          <div class="history-title" title="${title}">${title}</div>
          <div class="history-meta">${format} • ${item.seasonYear || ''} • ${item.averageScore ? `${item.averageScore}%` : 'N/A'}</div>
        </div>
        <button type="button" class="mini-btn view-roll-btn">
          View
        </button>
      `;

      row.querySelector('.view-roll-btn').addEventListener('click', () => {
        displayAnime(item);
        closeModal('history-modal');
      });

      list.appendChild(row);
    });
  }

  // ==========================================================================
  // Modal & Video Dialogs
  // ==========================================================================

  function extractVideoId(raw) {
    if (!raw) return '';
    const clean = String(raw).trim();
    // Match standard 11-char YouTube ID even if raw was a URL or contains query parameters
    const match = clean.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=)|(?:^|\W))([a-zA-Z0-9_-]{11})(?:$|\W)/);
    if (match && match[1]) {
      return match[1];
    }
    return clean.replace(/[^a-zA-Z0-9_-]/g, '');
  }

  function openTrailerModal() {
    if (!STATE.currentAnime) return;
    const anime = STATE.currentAnime;
    const title = anime.title.english || anime.title.romaji;
    const container = document.getElementById('video-container');
    const directBtn = document.getElementById('trailer-yt-direct-btn');
    const fallbackYtBtn = document.getElementById('trailer-fallback-yt-btn');
    const fallbackSearchBtn = document.getElementById('trailer-fallback-search-btn');
    const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(title + ' anime official trailer')}`;

    if (fallbackSearchBtn) {
      fallbackSearchBtn.href = searchUrl;
    }

    const rawSite = (anime.trailer?.site || '').toLowerCase();
    const rawId = anime.trailer?.id;
    const videoId = extractVideoId(rawId);

    // If no trailer was provided by AniList for this anime, open YouTube search directly
    if (!videoId) {
      window.open(searchUrl, '_blank', 'noopener,noreferrer');
      showToast(`Opening YouTube search for "${title}" trailer...`, 'info');
      return;
    }

    if (rawSite === 'youtube') {
      const ytWatchUrl = `https://www.youtube.com/watch?v=${videoId}`;
      if (directBtn) {
        directBtn.href = ytWatchUrl;
        directBtn.textContent = 'Watch on YouTube ↗';
        directBtn.classList.remove('hidden');
      }
      if (fallbackYtBtn) {
        fallbackYtBtn.href = ytWatchUrl;
        fallbackYtBtn.textContent = 'Open Official Trailer on YouTube ↗';
        fallbackYtBtn.classList.remove('hidden');
      }

      // Standard youtube.com embed with strict-origin-when-cross-origin referrerpolicy
      const pageOrigin = (window.location.origin && window.location.origin !== 'null') ? window.location.origin : 'https://localhost';
      container.innerHTML = `
        <iframe 
          src="https://www.youtube.com/embed/${videoId}?autoplay=1&enablejsapi=1&rel=0&origin=${encodeURIComponent(pageOrigin)}" 
          title="${title} Official Trailer" 
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" 
          referrerpolicy="strict-origin-when-cross-origin"
          allowfullscreen>
        </iframe>
      `;
    } else if (rawSite === 'dailymotion') {
      const dmUrl = `https://www.dailymotion.com/video/${videoId}`;
      if (directBtn) {
        directBtn.href = dmUrl;
        directBtn.textContent = 'Watch on Dailymotion ↗';
        directBtn.classList.remove('hidden');
      }
      if (fallbackYtBtn) {
        fallbackYtBtn.href = dmUrl;
        fallbackYtBtn.textContent = 'Open on Dailymotion ↗';
        fallbackYtBtn.classList.remove('hidden');
      }

      container.innerHTML = `
        <iframe 
          src="https://www.dailymotion.com/embed/video/${videoId}?autoplay=1" 
          title="${title} Official Trailer" 
          allow="autoplay; fullscreen; picture-in-picture" 
          allowfullscreen>
        </iframe>
      `;
    } else {
      window.open(searchUrl, '_blank', 'noopener,noreferrer');
      showToast(`Opening YouTube search for "${title}" trailer...`, 'info');
      return;
    }

    document.getElementById('trailer-modal-title').textContent = `${title} — Official Trailer`;
    document.getElementById('trailer-modal').classList.remove('hidden');
  }

  function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (!modal) return;
    modal.classList.add('hidden');

    if (modalId === 'trailer-modal') {
      document.getElementById('video-container').innerHTML = '';
    }
  }

  // ==========================================================================
  // Toast Notifications
  // ==========================================================================

  function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;

    let icon = 'ℹ️';
    if (type === 'success') icon = '✅';
    if (type === 'warning') icon = '⚠️';

    toast.innerHTML = `<span>${icon}</span> <span>${message}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 3200);
  }

  // ==========================================================================
  // Event Listeners & Wire-up
  // ==========================================================================

  function setupEventListeners() {
    // Master Roll Button
    document.getElementById('roll-anime-btn').addEventListener('click', rollRandomAnime);

    // Surprise Me Button
    document.getElementById('surprise-me-btn').addEventListener('click', () => {
      resetAllFilters();
      rollRandomAnime();
    });

    // Reset Filters Button
    document.getElementById('reset-filters-btn').addEventListener('click', resetAllFilters);
    document.getElementById('error-reset-btn').addEventListener('click', resetAllFilters);

    // Genre Presets
    document.getElementById('presets-list').addEventListener('click', (e) => {
      const chip = e.target.closest('.preset-chip');
      if (chip && chip.dataset.preset) {
        applyPreset(chip.dataset.preset);
      }
    });

    // Genre Select All & Clear
    document.getElementById('select-all-genres-btn').addEventListener('click', () => {
      STATE.selectedGenres.clear();
      STATE.excludedGenres.clear();
      STATE.genres.forEach(g => STATE.selectedGenres.add(g));
      renderGenreChips();
      showToast('All genres selected', 'info');
    });

    document.getElementById('clear-all-genres-btn').addEventListener('click', () => {
      STATE.selectedGenres.clear();
      STATE.excludedGenres.clear();
      renderGenreChips();
      showToast('Genre filters cleared', 'info');
    });

    // Genre Mode Toggle (Any / All)
    document.getElementById('mode-any-btn').addEventListener('click', () => {
      STATE.genreMatchMode = 'ANY';
      document.getElementById('mode-any-btn').classList.add('active');
      document.getElementById('mode-all-btn').classList.remove('active');
      showToast('Matching ANY selected genre (OR)', 'info');
    });

    document.getElementById('mode-all-btn').addEventListener('click', () => {
      STATE.genreMatchMode = 'ALL';
      document.getElementById('mode-all-btn').classList.add('active');
      document.getElementById('mode-any-btn').classList.remove('active');
      showToast('Matching ALL selected genres (AND)', 'info');
    });

    // Custom Tag Form Submit
    const customForm = document.getElementById('add-custom-tag-form');
    const customInput = document.getElementById('custom-genre-input');
    if (customForm && customInput) {
      customForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const val = customInput.value;
        if (val) {
          addCustomTag(val);
          customInput.value = '';
        }
      });
    }

    // Popular suggestions click
    const suggestionsList = document.getElementById('popular-suggestions-list');
    if (suggestionsList) {
      suggestionsList.addEventListener('click', (e) => {
        const btn = e.target.closest('.suggestion-chip');
        if (btn && btn.dataset.tag) {
          addCustomTag(btn.dataset.tag);
        }
      });
    }

    // Accordion Toggle
    document.getElementById('adv-filter-toggle').addEventListener('click', () => {
      const content = document.getElementById('adv-filter-content');
      const trigger = document.getElementById('adv-filter-toggle');
      const isExpanded = !content.classList.contains('hidden');

      if (isExpanded) {
        content.classList.add('hidden');
        trigger.classList.add('collapsed');
      } else {
        content.classList.remove('hidden');
        trigger.classList.remove('collapsed');
      }
    });

    // Filter Inputs
    document.getElementById('filter-mode').addEventListener('change', (e) => {
      STATE.currentFilters.discoveryMode = e.target.value;
    });

    document.getElementById('filter-format').addEventListener('change', (e) => {
      STATE.currentFilters.format = e.target.value;
    });

    const scoreSlider = document.getElementById('filter-score');
    const scoreDisplay = document.getElementById('score-display');
    scoreSlider.addEventListener('input', (e) => {
      const val = parseInt(e.target.value, 10);
      STATE.currentFilters.minScore = val;
      scoreDisplay.textContent = val > 0 ? `${val}%+ Score` : 'Any Score';
    });

    document.getElementById('filter-era').addEventListener('change', (e) => {
      STATE.currentFilters.era = e.target.value;
    });

    document.getElementById('filter-status').addEventListener('change', (e) => {
      STATE.currentFilters.status = e.target.value;
    });

    document.getElementById('sfw-only-checkbox').addEventListener('change', (e) => {
      STATE.currentFilters.sfwOnly = e.target.checked;
    });

    // Synopsis expand
    document.getElementById('expand-synopsis-btn').addEventListener('click', (e) => {
      const textElem = document.getElementById('anime-synopsis');
      if (textElem.classList.contains('collapsed')) {
        textElem.classList.remove('collapsed');
        e.target.textContent = 'Show Less';
      } else {
        textElem.classList.add('collapsed');
        e.target.textContent = 'Read More';
      }
    });

    // Watchlist Save Button
    document.getElementById('toggle-watchlist-btn').addEventListener('click', toggleWatchlistCurrentAnime);

    // Watch Trailer Button
    document.getElementById('watch-trailer-btn').addEventListener('click', openTrailerModal);
    document.getElementById('close-trailer-btn').addEventListener('click', () => closeModal('trailer-modal'));

    // Share / Copy Link
    document.getElementById('copy-share-btn').addEventListener('click', () => {
      if (!STATE.currentAnime) return;
      const title = STATE.currentAnime.title.english || STATE.currentAnime.title.romaji;
      const url = STATE.currentAnime.siteUrl || `https://anilist.co/anime/${STATE.currentAnime.id}`;
      const shareText = `Check out "${title}" on AniList: ${url}`;

      navigator.clipboard.writeText(shareText).then(() => {
        showToast('Copied share link to clipboard!', 'success');
      }).catch(() => {
        showToast(`Anime: ${title}`, 'info');
      });
    });

    // Similar Anime Button
    document.getElementById('roll-similar-btn').addEventListener('click', () => {
      if (!STATE.currentAnime || !STATE.currentAnime.genres) return;
      STATE.selectedGenres.clear();
      STATE.excludedGenres.clear();
      // Pick top 2 genres from current anime
      STATE.currentAnime.genres.slice(0, 2).forEach(g => STATE.selectedGenres.add(g));
      renderGenreChips();
      rollRandomAnime();
      showToast(`Rolling similar anime for: ${Array.from(STATE.selectedGenres).join(', ')}`, 'info');
    });

    // Watchlist Modal
    document.getElementById('watchlist-modal-btn').addEventListener('click', () => {
      renderWatchlistModal();
      document.getElementById('watchlist-modal').classList.remove('hidden');
    });
    document.getElementById('close-watchlist-btn').addEventListener('click', () => closeModal('watchlist-modal'));
    document.getElementById('watchlist-search-input').addEventListener('input', renderWatchlistModal);
    document.getElementById('clear-watchlist-btn').addEventListener('click', () => {
      if (confirm('Are you sure you want to clear your saved watchlist?')) {
        STATE.watchlist = [];
        saveWatchlist();
        renderWatchlistModal();
        showToast('Watchlist cleared', 'info');
      }
    });

    // History Modal
    document.getElementById('history-modal-btn').addEventListener('click', () => {
      renderHistoryModal();
      document.getElementById('history-modal').classList.remove('hidden');
    });
    document.getElementById('close-history-btn').addEventListener('click', () => closeModal('history-modal'));
    document.getElementById('clear-history-btn').addEventListener('click', () => {
      STATE.rollHistory = [];
      saveHistory();
      renderHistoryModal();
      renderRecentReel();
      showToast('Roll history cleared', 'info');
    });

    // Sound Toggle Button
    const sfxBtn = document.getElementById('sfx-toggle-btn');
    sfxBtn.addEventListener('click', () => {
      STATE.soundEnabled = !STATE.soundEnabled;
      const onIcon = sfxBtn.querySelector('.sfx-on-icon');
      const offIcon = sfxBtn.querySelector('.sfx-off-icon');

      if (STATE.soundEnabled) {
        onIcon.classList.remove('hidden');
        offIcon.classList.add('hidden');
        showToast('Sound effects enabled', 'info');
        playTickSound();
      } else {
        onIcon.classList.add('hidden');
        offIcon.classList.remove('hidden');
        showToast('Sound effects muted', 'info');
      }
    });

    // Keyboard Shortcuts
    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
        return;
      }

      if (e.code === 'Space') {
        e.preventDefault();
        rollRandomAnime();
      } else if (e.key === 'Escape') {
        closeModal('trailer-modal');
        closeModal('watchlist-modal');
        closeModal('history-modal');
      }
    });

    // Close modals on overlay backdrop click
    document.querySelectorAll('.modal-overlay').forEach(modal => {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          closeModal(modal.id);
        }
      });
    });
  }

  // ==========================================================================
  // Initialization
  // ==========================================================================

  async function init() {
    loadSavedData();
    setupEventListeners();
    await loadGenresAndTags();
  }

  // Launch on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();

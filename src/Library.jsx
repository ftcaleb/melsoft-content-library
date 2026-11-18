import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Icon from "./Icon";
import "./library.css";

/* ── The content library ──────────────────────────────────────────────
   The marketing team’s photo and video library: everything in the
   "Melsoft Content" Google Drive folder, grouped by folder. Kept out of
   search engines (noindex).

   Team only: the list comes from /api/library, which answers only for a
   signed-in @melsoftacademy.com address. Signing in emails a link
   (api/auth.js). Nothing about the library is bundled into this code.
   Each top-level Drive folder is a folder here (/folders/<slug>); each
   subfolder inside it is an album section on the folder’s page.

   Prints on white mounts, mono file labels, sliding-pill tabs and a dark
   viewer. Static layout; motion is limited to hover states and the
   tiles’ fade-in.                                                      */

const HOME = "/";
const folderHref = (slug) => `/folders/${slug}`;

/* Public Drive URLs. Images load with referrerPolicy="no-referrer": Google
   answers 429 to image requests whose Referer is localhost. */
const drive = {
  thumb: (id, w = 600) => `https://drive.google.com/thumbnail?id=${id}&sz=w${w}`,
  download: (id) => `https://drive.google.com/uc?export=download&id=${id}`,
  view: (id) => `https://drive.google.com/file/d/${id}/view`,
  embed: (id) => `https://drive.google.com/file/d/${id}/preview`,
  folder: (id) => `https://drive.google.com/drive/folders/${id}`,
};

const nf = new Intl.NumberFormat("en-ZA");
const pad2 = (n) => String(n).padStart(2, "0");
const plural = (n, one, many = one + "s") => `${nf.format(n)} ${n === 1 ? one : many}`;
const cleanName = (s) => s.replace(/\s+/g, " ").replace(/[_\s]+$/, "").trim();

/* "today", "yesterday", "4 days ago", then "30 Sep" (and the year when it
   isn't this year). Dates are YYYY-MM-DD from the sync. */
const when = (isoDate) => {
  if (!isoDate) return null;
  const d = new Date(isoDate + "T12:00:00");
  const now = new Date();
  const days = Math.round((new Date(now.toDateString()) - new Date(d.toDateString())) / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  const opts = { day: "numeric", month: "short", ...(d.getFullYear() !== now.getFullYear() && { year: "numeric" }) };
  return d.toLocaleDateString("en-GB", opts);
};

const countLine = (photos, videos) => [photos && plural(photos, "photo"), videos && plural(videos, "video")].filter(Boolean).join(" · ") || "Empty";

/* ── The library, prepared once ────────────────────────────────────── */
const prepareFolder = (f) => {
  const title = cleanName(f.name);
  const albums = f.albums.map((a) => {
    const label = a.path.length ? a.path.map(cleanName).join(" / ") : "Main folder";
    return {
      ...a, key: a.id, label, depth: a.path.length,
      items: a.items.map((it) => ({
        ...it, key: `${a.id}:${it.id}`, folder: title, album: label, albumId: a.id,
        thumb: drive.thumb(it.id), full: drive.thumb(it.id, 1800),
        download: drive.download(it.id), view: drive.view(it.id),
        embed: it.kind === "video" ? drive.embed(it.id) : null,
      })),
    };
  });
  const items = albums.flatMap((a) => a.items);
  const photos = items.filter((i) => i.kind === "image").length;
  return {
    ...f, title, albums, items, photos, videos: items.length - photos,
    subfolders: albums.filter((a) => a.depth > 0).length,
    url: drive.folder(f.id),
  };
};
const prepare = (data) => {
  const folders = (data.folders || []).map(prepareFolder);
  const withMedia = folders.filter((f) => f.items.length);
  return {
    folders, withMedia,
    docsOnly: folders.filter((f) => !f.items.length),
    photos: withMedia.reduce((n, f) => n + f.photos, 0),
    videos: withMedia.reduce((n, f) => n + f.videos, 0),
    folderUrl: data.folderUrl, syncedAt: data.syncedAt, saved: !!data.saved,
  };
};

/* One request per visit, shared by every view: "ready" with the list,
   "signin" when there's no valid session (401), "error" otherwise. */
const AUTH = "/api/auth";
let request = null;
let ready = null;
const fetchLibrary = () => fetch("/api/library", { headers: { Accept: "application/json" }, credentials: "same-origin" })
  .then(async (r) => {
    if (r.status === 401) return { status: "signin" };
    const d = r.ok ? await r.json() : null;
    if (!d || !Array.isArray(d.folders)) return { status: "error" };
    return (ready = { status: "ready", lib: prepare(d), viewer: d.viewer || null });
  })
  .catch(() => ({ status: "error" }));

const useLibrary = () => {
  const [state, setState] = useState(() => ready || { status: "loading" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let on = true;
    request ??= fetchLibrary();
    request.then((s) => {
      if (s.status !== "ready") request = null; // ask again next time
      if (on) setState(s);
    });
    return () => { on = false; };
  }, [attempt]);
  const retry = useCallback(() => { setState({ status: "loading" }); setAttempt((n) => n + 1); }, []);
  const signOut = useCallback(async () => {
    await fetch(AUTH, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "signout" }) }).catch(() => {});
    request = null;
    ready = null;
    setState({ status: "signin" });
  }, []);
  return { ...state, retry, signOut };
};

/* "just now", "4 minutes ago", "2 hours ago", then the date. */
const ago = (isoTime) => {
  const t = new Date(isoTime);
  const mins = Math.round((Date.now() - t) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${plural(mins, "minute")} ago`;
  if (mins < 24 * 60) return `${plural(Math.round(mins / 60), "hour")} ago`;
  return `on ${t.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}`;
};

/* Where the list on screen came from, how fresh it is, and who's in. */
const LibraryFoot = ({ lib, viewer, onSignOut }) => (
  <footer className="cl-foot">
    <div className="cl-wrap cl-foot__in">
      <p>
        {lib.saved ? (
          <>Showing the saved copy from {ago(lib.syncedAt).replace(/^on /, "")}: Google Drive couldn&rsquo;t be reached just now. Refresh to try again.</>
        ) : (
          <><span className="cl-foot__dot" aria-hidden="true" />Live from Google Drive, checked {ago(lib.syncedAt)}. New uploads show up here within about 10 minutes.</>
        )}
      </p>
      {viewer && (
        <p className="cl-foot__who">
          Signed in as {viewer} <button type="button" className="cl-link" onClick={onSignOut}>Sign out</button>
        </p>
      )}
    </div>
  </footer>
);

/* Three covers per folder, front first: photos where there are any,
   spread across the folder rather than three frames of one burst. */
const coversFor = (f) => {
  const photos = f.items.filter((i) => i.kind === "image");
  const pool = photos.length >= 3 ? photos : [...photos, ...f.items.filter((i) => i.kind === "video")];
  const picks = [0, Math.floor(pool.length / 2), pool.length - 1].map((i) => pool[i]).filter(Boolean);
  return [...new Map(picks.map((p) => [p.key, p])).values()];
};

/* ── Small pieces ──────────────────────────────────────────────────── */
const DownloadIcon = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 4v11" /><path d="m7 10 5 5 5-5" /><path d="M5 20h14" />
  </svg>
);
const LinkIcon = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1.2 1.2" />
    <path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1.2-1.2" />
  </svg>
);

/* Images download in place; a large video lands on Drive's "can't scan
   for viruses" page first, so videos open in a new tab instead. */
const dlProps = (it) => (it.kind === "video"
  ? { href: it.download, target: "_blank", rel: "noopener noreferrer" }
  : { href: it.download, download: it.name, rel: "noopener" });

const copyText = async (text) => {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* fall through */ }
  try {
    const ta = document.createElement("textarea");
    ta.value = text; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch { return false; }
};

const colsFor = () => (typeof window === "undefined" ? 4
  : window.innerWidth < 640 ? 2 : window.innerWidth < 1080 ? 3 : window.innerWidth < 1500 ? 4 : 5);
const useColumns = () => {
  const [cols, setCols] = useState(colsFor);
  useEffect(() => {
    const on = () => setCols(colsFor());
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return cols;
};

/* Sliding-pill tabs, as on the hackathon gallery: the pill spans the row
   and is clipped to the active tab, so it animates clip-path, not width. */
const Tabs = ({ tabs, value, onChange, label }) => {
  const rowRef = useRef(null);
  const [pill, setPill] = useState(null);
  useLayoutEffect(() => {
    const measure = () => {
      const row = rowRef.current;
      const el = row?.querySelector('[aria-selected="true"]');
      if (el) setPill({ x: el.offsetLeft, w: el.offsetWidth, total: row.scrollWidth });
    };
    measure();
    window.addEventListener("resize", measure);
    document.fonts?.ready.then(measure).catch(() => {});
    return () => window.removeEventListener("resize", measure);
  }, [value, tabs]);
  return (
    <div className="cl-tabs" role="tablist" aria-label={label} ref={rowRef}>
      {pill && <span className="cl-tabs__pill" aria-hidden="true" style={{
        width: pill.total,
        clipPath: `inset(0 ${pill.total - pill.x - pill.w}px 0 ${pill.x}px round 999px)`,
      }} />}
      {tabs.map((t) => (
        <button key={t.value} type="button" role="tab" aria-selected={value === t.value}
          className={"cl-tabs__btn" + (value === t.value ? " is-on" : "")} onClick={() => onChange(t.value)}>
          {t.label}<span className="cl-tabs__n">{nf.format(t.count)}</span>
        </button>
      ))}
    </div>
  );
};

const TYPE_TABS = (photos, videos) => [
  { value: "all", label: "Everything", count: photos + videos },
  { value: "image", label: "Photos", count: photos },
  { value: "video", label: "Videos", count: videos },
];
const byType = (type) => (it) => type === "all" || it.kind === type;

/* ── Viewer ────────────────────────────────────────────────────────── */
const ViewerImage = ({ item }) => {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <p className="cl-viewer__none">
        Drive has no preview for this file yet.<br />Download it, or open it in Drive.
      </p>
    );
  }
  return <img className="cl-viewer__img" src={item.full} alt={item.name} referrerPolicy="no-referrer" onError={() => setFailed(true)} />;
};

const Viewer = ({ items, index, onClose, onMove, onJump, onCopy }) => {
  const item = items[index];
  const closeRef = useRef(null);
  const stripRef = useRef(null);
  const touch = useRef(null);

  useEffect(() => {
    const prev = document.activeElement;
    closeRef.current?.focus();
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; prev?.focus?.(); };
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") onMove(1);
      else if (e.key === "ArrowLeft") onMove(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, onMove]);

  useEffect(() => {
    const strip = stripRef.current;
    const on = strip?.querySelector(".is-on");
    if (strip && on) strip.scrollTo({ left: on.offsetLeft - strip.clientWidth / 2 + on.clientWidth / 2, behavior: "smooth" });
    const next = items[(index + 1) % items.length];
    if (next?.kind === "image") { const img = new Image(); img.referrerPolicy = "no-referrer"; img.src = next.full; }
  }, [index, items]);

  if (!item) return null;
  const onTouchStart = (e) => { touch.current = e.touches[0].clientX; };
  const onTouchEnd = (e) => {
    if (touch.current == null) return;
    const dx = e.changedTouches[0].clientX - touch.current;
    if (Math.abs(dx) > 50) onMove(dx < 0 ? 1 : -1);
    touch.current = null;
  };

  return createPortal(
    <div className="cl-viewer" role="dialog" aria-modal="true" aria-label={`${item.name}, ${index + 1} of ${items.length}`}>
      <div className="cl-viewer__top">
        <div className="cl-viewer__where">
          <span className="cl-viewer__album">{item.folder}{item.album !== "Main folder" && <> / {item.album}</>}</span>
          <span className="cl-viewer__name" title={item.name}>{item.name}</span>
        </div>
        <span className="cl-viewer__count">{index + 1} / {items.length}</span>
        <button ref={closeRef} type="button" className="cl-viewer__icon" onClick={onClose} aria-label="Close viewer">
          <Icon name="close" size={20} />
        </button>
      </div>

      <div className="cl-viewer__stage" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        <button type="button" className="cl-viewer__nav" onClick={() => onMove(-1)} aria-label="Previous"><Icon name="chevron-left" size={24} /></button>
        {item.kind === "video" ? (
          <div className="cl-viewer__video" key={item.key}>
            <iframe src={item.embed} title={item.name} allow="autoplay; fullscreen" allowFullScreen referrerPolicy="no-referrer" />
          </div>
        ) : (
          <ViewerImage key={item.key} item={item} />
        )}
        <button type="button" className="cl-viewer__nav" onClick={() => onMove(1)} aria-label="Next"><Icon name="chevron-right" size={24} /></button>
      </div>

      <div className="cl-viewer__foot">
        <div className="cl-viewer__strip" ref={stripRef}>
          {items.map((it, i) => (
            <button key={it.key} type="button" className={"cl-viewer__thumb" + (i === index ? " is-on" : "")}
              onClick={() => onJump(i)} aria-label={`Show ${it.name}`} aria-current={i === index ? "true" : undefined}>
              <img src={drive.thumb(it.id, 160)} alt="" loading="lazy" referrerPolicy="no-referrer"
                onError={(e) => { e.currentTarget.style.visibility = "hidden"; }} />
            </button>
          ))}
        </div>
        <div className="cl-viewer__actions">
          <a className="cl-btn cl-btn--light" {...dlProps(item)}><DownloadIcon /> Download</a>
          <button type="button" className="cl-btn cl-btn--ghost" onClick={() => onCopy(item.view)}><LinkIcon /> Copy link</button>
          <a className="cl-btn cl-btn--ghost" href={item.view} target="_blank" rel="noopener noreferrer" aria-label="Open in Drive">
            Drive <Icon name="arrow-up-right" size={15} />
          </a>
        </div>
      </div>
    </div>,
    document.body,
  );
};

/* ── A print on the sheet ──────────────────────────────────────────── */
/* Drive has no thumbnail for some files (a video uploaded minutes ago is
   still processing; some formats never get one). Show a quiet stand-in
   rather than the browser's broken-image icon. */
const NoPreview = ({ kind }) => (
  <span className="cl-none" aria-hidden="true">
    <Icon name={kind === "video" ? "film" : "camera"} size={22} />
    <span>No preview yet</span>
  </span>
);

const Tile = ({ item, delay, onOpen, onCopy }) => {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <figure className={"cl-tile" + (loaded || failed ? " is-loaded" : "")} style={{ "--d": `${delay}ms` }}>
      <button type="button" className="cl-tile__open" onClick={onOpen} aria-label={`Open ${item.name}`}>
        {failed ? <NoPreview kind={item.kind} /> : (
          <img src={item.thumb} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer"
            onLoad={() => setLoaded(true)} onError={() => setFailed(true)} />
        )}
        {item.kind === "video" && !failed && <span className="cl-tile__play" aria-hidden="true"><Icon name="play" size={16} /></span>}
      </button>
      <figcaption className="cl-tile__cap">
        <span className="cl-tile__name" title={item.name}>{item.name}</span>
        <span className="cl-tile__acts">
          <button type="button" className="cl-ico" onClick={() => onCopy(item.view)} aria-label={`Copy link to ${item.name}`} title="Copy link">
            <LinkIcon size={15} />
          </button>
          <a className="cl-ico" {...dlProps(item)} aria-label={`Download ${item.name}`} title="Download">
            <DownloadIcon size={15} />
          </a>
        </span>
      </figcaption>
    </figure>
  );
};

/* Row-major masonry: item 1 left, item 2 beside it, so a burst of
   near-identical shots runs across a row instead of down one column. */
const Sheet = ({ items, cols, onOpen, onCopy }) => {
  const columns = useMemo(() => {
    const out = Array.from({ length: cols }, () => []);
    items.forEach((it, i) => out[i % cols].push({ it, i }));
    return out;
  }, [items, cols]);
  return (
    <div className="cl-sheet" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
      {columns.map((col, c) => (
        <div key={c} className="cl-sheet__col">
          {col.map(({ it, i }) => (
            <Tile key={it.key} item={it} delay={Math.min(i, 16) * 30} onOpen={() => onOpen(it)} onCopy={onCopy} />
          ))}
        </div>
      ))}
    </div>
  );
};

/* One subfolder: its path, counts and links, then its prints. Long
   albums show a first batch and grow on request. */
const STEP = 48;
const Album = ({ album, items, first, cols, onOpen, onCopy, context }) => {
  const [shown, setShown] = useState(first);
  // Back to the first batch when the filter changes what's in the album.
  const sig = `${first}:${items.length}`;
  const [seenSig, setSeenSig] = useState(sig);
  if (seenSig !== sig) { setSeenSig(sig); setShown(first); }
  const photos = items.filter((i) => i.kind === "image").length;
  const parts = album.label.split(" / ");
  const left = items.length - shown;
  return (
    <section className="cl-album" id={`al-${album.id}`} aria-label={album.label}>
      <header className="cl-album__head">
        <h2 className="cl-album__title">
          {context && <span className="cl-album__ctx">{context} / </span>}
          {parts.slice(0, -1).map((p) => <span key={p} className="cl-album__ctx">{p} / </span>)}
          <span>{parts[parts.length - 1]}</span>
        </h2>
        <span className="cl-album__n">{countLine(photos, items.length - photos)}</span>
        <span className="cl-album__acts">
          <button type="button" className="cl-link" onClick={() => onCopy(drive.folder(album.id))}><LinkIcon size={14} /> Copy link</button>
          <a className="cl-link" href={drive.folder(album.id)} target="_blank" rel="noopener noreferrer">Drive <Icon name="arrow-up-right" size={13} /></a>
        </span>
      </header>
      <Sheet items={items.slice(0, shown)} cols={cols} onOpen={onOpen} onCopy={onCopy} />
      {left > 0 && (
        <div className="cl-more">
          <button type="button" className="cl-btn cl-btn--line" onClick={() => setShown((s) => s + STEP)}>
            Show {Math.min(STEP, left)} more <span className="cl-more__n">{nf.format(left)} left</span>
          </button>
          {left > STEP && <button type="button" className="cl-link" onClick={() => setShown(items.length)}>Show all {nf.format(items.length)}</button>}
        </div>
      )}
    </section>
  );
};

/* ── Folder on the index: a small stack of prints ──────────────────── */
const Print = ({ item, i }) => {
  const [failed, setFailed] = useState(false);
  return (
    <span className={`cl-print cl-print--${i}`}>
      {failed ? <span className="cl-print__none"><NoPreview kind={item.kind} /></span> : (
        <img src={drive.thumb(item.id, i === 0 ? 720 : 420)} alt="" loading="lazy" decoding="async"
          referrerPolicy="no-referrer" onError={() => setFailed(true)} />
      )}
      {i === 0 && item.kind === "video" && !failed && <span className="cl-print__play"><Icon name="play" size={14} /></span>}
    </span>
  );
};

const FolderCard = ({ folder, n, navigate, type }) => {
  const covers = useMemo(() => coversFor(folder), [folder]);
  const href = folderHref(folder.slug);
  const photos = type === "video" ? 0 : folder.photos;
  const videos = type === "image" ? 0 : folder.videos;
  return (
    <li className="cl-folder">
      <a className="cl-folder__link" href={href} onClick={(e) => { e.preventDefault(); navigate(href); }}>
        <span className={`cl-stack cl-stack--n${covers.length}`} aria-hidden="true">
          {[...covers].reverse().map((c) => <Print key={c.key} item={c} i={covers.indexOf(c)} />)}
        </span>
        <span className="cl-folder__body">
          <span className="cl-folder__top">
            <span className="cl-folder__no">{pad2(n)}</span>
            {folder.updated && <span className="cl-folder__date">Updated {when(folder.updated)}</span>}
          </span>
          <span className="cl-folder__name">{folder.title}</span>
          <span className="cl-folder__meta">
            {countLine(photos, videos)}
            {folder.subfolders > 0 && <> · {plural(folder.subfolders, "subfolder")}</>}
          </span>
        </span>
      </a>
    </li>
  );
};

/* ── Subfolder tree for the folder page's side rail ────────────────── */
const treeRows = (albums) => {
  const rows = [];
  const seen = new Set();
  albums.forEach((a) => {
    a.path.forEach((_, d) => {
      const key = a.path.slice(0, d + 1).join("/");
      if (seen.has(key)) return;
      seen.add(key);
      if (d === a.path.length - 1) return; // the album itself, added below
      rows.push({ key, label: cleanName(a.path[d]), depth: d, group: true });
    });
    rows.push({ key: a.path.join("/") || "~", label: a.depth ? cleanName(a.path[a.path.length - 1]) : "Main folder", depth: Math.max(0, a.depth - 1), album: a });
  });
  return rows;
};

/* ── Page ──────────────────────────────────────────────────────────── */
const ContentLibraryPage = ({ navigate, slug }) => {
  const { status, lib, viewer, retry, signOut } = useLibrary();

  // Unlisted: keep it out of search engines (vercel.json sends the header too).
  useEffect(() => {
    const tag = document.createElement("meta");
    tag.name = "robots";
    tag.content = "noindex, nofollow";
    document.head.appendChild(tag);
    return () => tag.remove();
  }, []);

  if (status === "ready") return <Library navigate={navigate} slug={slug} lib={lib} viewer={viewer} onSignOut={signOut} />;
  return <Gate status={status} navigate={navigate} onRetry={retry} />;
};

/* ── Signed out, loading or unreachable ────────────────────────────── */
const GateBar = ({ navigate }) => {
  const go = (to) => (e) => { e.preventDefault(); navigate(to); };
  return (
    <header className="cl-bar cl-bar--gate">
      <div className="cl-bar__in">
        <a className="cl-bar__logo" href="/" onClick={go("/")} aria-label="Content library home">
          <img src="/logo.webp" alt="" width="702" height="302" />
        </a>
        <span className="cl-bar__title">Content library</span>
      </div>
    </header>
  );
};

const NOT_TEAM = "Use your @melsoftacademy.com email address.";

const Gate = ({ status, navigate, onRetry }) => {
  // ?signin=expired: the emailed link was too old (or tampered with).
  const [notice] = useState(() => (typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("signin")));
  const [email, setEmail] = useState("");
  const [phase, setPhase] = useState("idle"); // idle | sending | sent
  const [sentTo, setSentTo] = useState("");
  const [error, setError] = useState(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (notice) window.history.replaceState(window.history.state, "", window.location.pathname);
  }, [notice]);
  useEffect(() => {
    document.title = status === "signin" ? "Sign in · Content library | Melsoft" : "Content library | Melsoft";
  }, [status]);

  const send = async (e) => {
    e?.preventDefault();
    const raw = email.trim().toLowerCase();
    const full = raw && !raw.includes("@") ? `${raw}@melsoftacademy.com` : raw;
    if (!/^[^\s@]+@melsoftacademy\.com$/.test(full)) {
      setError(NOT_TEAM);
      inputRef.current?.focus();
      return;
    }
    setError(null);
    setPhase("sending");
    try {
      const r = await fetch(AUTH, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "send", email: full, next: window.location.pathname }),
      });
      if (r.ok) { setSentTo(full); setPhase("sent"); return; }
      const d = await r.json().catch(() => ({}));
      setError(d.error === "domain" ? NOT_TEAM : "The email didn’t send. Try again in a minute.");
    } catch {
      setError("You seem to be offline. Check your connection and try again.");
    }
    setPhase("idle");
  };

  let body;
  if (status === "loading") {
    body = (
      <div className="cl-gate__loading" role="status">
        <span className="cl-label">Content library</span>
        <span className="cl-skel cl-skel--h1" />
        <span className="cl-skel cl-skel--h1 cl-skel--short" />
        <span className="cl-skel cl-skel--line" />
        <span className="cl-sr">Loading the library…</span>
      </div>
    );
  } else if (status === "error") {
    body = (
      <>
        <span className="cl-label">Content library</span>
        <h1 className="cl-h1">Google Drive <em>didn&rsquo;t answer.</em></h1>
        <p className="cl-lede">The library reads straight from the Melsoft Content Drive, and it couldn&rsquo;t be reached just now.</p>
        <button type="button" className="cl-btn cl-btn--ink cl-gate__cta" onClick={onRetry}>Try again <Icon name="arrow-right" size={17} /></button>
      </>
    );
  } else if (phase === "sent") {
    body = (
      <>
        <span className="cl-label">Almost there</span>
        <h1 className="cl-h1">Check your <em>inbox.</em></h1>
        <p className="cl-lede" role="status">
          We sent a sign-in link to <b>{sentTo}</b>. It works for 30 minutes. Open it in this browser and you&rsquo;ll stay
          signed in for 30 days.
        </p>
        <p className="cl-gate__small">
          Nothing after a few minutes? Check Spam, or{" "}
          <button type="button" className="cl-link" onClick={() => { setPhase("idle"); setError(null); }}>use a different email</button>.
        </p>
      </>
    );
  } else {
    body = (
      <>
        <span className="cl-label">For the Melsoft team</span>
        <h1 className="cl-h1">Sign in to the <em className="cl-nowrap">content library.</em></h1>
        <p className="cl-lede">
          Every photo and video in the Melsoft Content Drive, for the team only. Enter your work email and
          we&rsquo;ll send you a sign-in link.
        </p>
        {notice === "expired" && (
          <p className="cl-gate__notice" role="alert">That sign-in link has expired. Links work for 30 minutes, so send yourself a new one.</p>
        )}
        <form className="cl-signin" onSubmit={send} noValidate>
          <label className={"cl-signin__field" + (error ? " is-error" : "")}>
            <span className="cl-sr">Work email</span>
            <Icon name="mail" size={17} />
            <input ref={inputRef} type="email" inputMode="email" autoComplete="email" autoFocus
              placeholder="name@melsoftacademy.com" value={email}
              onChange={(e) => { setEmail(e.target.value); if (error) setError(null); }}
              aria-invalid={!!error} aria-describedby={error ? "cl-signin-error" : undefined} />
          </label>
          <button type="submit" className="cl-btn cl-btn--ink" disabled={phase === "sending"}>
            {phase === "sending" ? "Sending…" : <>Email me a link <Icon name="arrow-right" size={17} /></>}
          </button>
        </form>
        {error && <p className="cl-signin__error" id="cl-signin-error" role="alert">{error}</p>}
      </>
    );
  }

  return (
    <main className="cl-page cl-page--gate">
      <GateBar navigate={navigate} />
      <section className="cl-hero cl-gate">
        <div className="cl-wrap">{body}</div>
      </section>
    </main>
  );
};

/* ── The library, once signed in ───────────────────────────────────── */
const Library = ({ navigate, slug, lib, viewer, onSignOut }) => {
  const folder = slug ? lib.folders.find((f) => f.slug === slug) : null;
  const [q, setQ] = useState("");
  const [type, setType] = useState("all");
  const [sort, setSort] = useState("recent");
  const [open, setOpen] = useState(null); // { list, index }
  const [toast, setToast] = useState(null);
  const searchRef = useRef(null);
  const toastTimer = useRef(null);
  const cols = useColumns();

  /* The bar wraps onto two rows on phones. Its real height drives the
     sticky offsets below it (toolbar, rail, album anchors). */
  const barObserver = useRef(null);
  const barRef = useCallback((el) => {
    barObserver.current?.disconnect();
    if (!el || typeof ResizeObserver === "undefined") return;
    const set = () => el.parentElement?.style.setProperty("--cl-bar", `${el.offsetHeight}px`);
    set();
    barObserver.current = new ResizeObserver(set);
    barObserver.current.observe(el);
  }, []);

  const term = q.trim().toLowerCase();
  const searching = term.length >= 2;

  // Leave search and the type filter behind when moving between folders.
  const [seenSlug, setSeenSlug] = useState(slug);
  if (seenSlug !== slug) { setSeenSlug(slug); setQ(""); setType("all"); }

  useEffect(() => {
    document.title = folder ? `${folder.title} · Content library | Melsoft` : "Content library | Melsoft";
  }, [folder]);

  // "/" jumps to search from anywhere on the page.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || open) return;
      const t = e.target;
      if (t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      e.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const copy = useCallback(async (text) => {
    const ok = await copyText(text);
    clearTimeout(toastTimer.current);
    setToast(ok ? "Link copied" : "Couldn't copy the link");
    toastTimer.current = setTimeout(() => setToast(null), 1800);
  }, []);

  const go = (to) => (e) => { e.preventDefault(); navigate(to); };
  const move = useCallback((d) => setOpen((o) => (o ? { ...o, index: (o.index + d + o.list.length) % o.list.length } : o)), []);
  const jump = useCallback((i) => setOpen((o) => (o ? { ...o, index: i } : o)), []);
  const close = useCallback(() => setOpen(null), []);
  const opener = (list) => (it) => setOpen({ list, index: Math.max(0, list.findIndex((x) => x.key === it.key)) });

  /* Search: every word has to appear in the file name, its subfolder path
     or its folder's name. Matching a folder name lists the whole folder. */
  const results = useMemo(() => {
    if (!searching) return null;
    const words = term.split(/\s+/).filter(Boolean);
    const hit = (s) => words.every((w) => s.includes(w));
    const pool = folder ? [folder] : lib.withMedia;
    const matched = [];
    pool.forEach((f) => f.albums.forEach((a) => {
      const items = a.items.filter((it) => hit(`${f.title} ${a.label} ${it.name}`.toLowerCase()));
      if (items.length) matched.push({ folder: f, album: a, items });
    }));
    const every = matched.flatMap((r) => r.items);
    const photos = every.filter((i) => i.kind === "image").length;
    const albums = matched
      .map((r) => ({ ...r, items: r.items.filter(byType(type)) }))
      .filter((r) => r.items.length);
    const folders = folder ? [] : lib.withMedia.filter((f) => hit(f.title.toLowerCase()));
    const flat = albums.flatMap((r) => r.items);
    return { albums, folders, flat, photos, videos: every.length - photos };
  }, [searching, term, type, folder, lib]);

  /* ── Top bar ── */
  const bar = (
    <header className="cl-bar" ref={barRef}>
      <div className="cl-bar__in">
        <a className="cl-bar__logo" href="/" onClick={go("/")} aria-label="Content library home">
          <img src="/logo.webp" alt="" width="702" height="302" />
        </a>
        <a className="cl-bar__title" href={HOME} onClick={go(HOME)}>Content library</a>
        <label className="cl-search">
          <Icon name="search" size={17} />
          <span className="cl-sr">Search</span>
          <input ref={searchRef} type="search" value={q} onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Escape") { setQ(""); e.currentTarget.blur(); } }}
            placeholder={folder ? `Search ${folder.title}` : "Search files and folders"} autoComplete="off" spellCheck="false" />
          {q ? (
            <button type="button" className="cl-search__clear" onClick={() => { setQ(""); searchRef.current?.focus(); }} aria-label="Clear search">
              <Icon name="close" size={15} />
            </button>
          ) : <kbd className="cl-search__kbd" aria-hidden="true">/</kbd>}
        </label>
        <a className="cl-btn cl-btn--line cl-bar__drive" href={folder ? folder.url : lib.folderUrl} target="_blank" rel="noopener noreferrer">
          <span><span className="cl-bar__long">Open in </span>Drive</span> <Icon name="arrow-up-right" size={15} />
        </a>
      </div>
    </header>
  );

  /* ── Search results (either view) ── */
  const resultsView = results && (
    <section className="cl-section">
      <div className="cl-toolbar">
        <div className="cl-wrap cl-toolbar__in">
          <p className="cl-results__h" aria-live="polite">
            {results.flat.length || results.folders.length
              ? <>{plural(results.flat.length, "file")} {folder ? `in ${folder.title} ` : ""}match <b>“{q.trim()}”</b></>
              : <>Nothing {folder ? `in ${folder.title} ` : ""}matches <b>“{q.trim()}”</b></>}
          </p>
          <Tabs label="File type" value={type} onChange={setType} tabs={TYPE_TABS(results.photos, results.videos)} />
        </div>
      </div>
      <div className="cl-wrap">
        {results.folders.length > 0 && (
          <div className="cl-results__folders">
            <span className="cl-label">Folders</span>
            <ul>
              {results.folders.map((f) => (
                <li key={f.id}>
                  <a href={folderHref(f.slug)} onClick={go(folderHref(f.slug))}>
                    <span>{f.title}</span><i>{countLine(f.photos, f.videos)}</i><Icon name="arrow-right" size={15} />
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}
        {results.albums.map((r) => (
          <Album key={r.album.id} album={r.album} items={r.items} first={12} cols={cols}
            context={folder ? null : r.folder.title} onOpen={opener(results.flat)} onCopy={copy} />
        ))}
        {!results.flat.length && !results.folders.length && (
          <p className="cl-empty">Try part of a file name, a person, an episode number or a folder name.</p>
        )}
      </div>
    </section>
  );

  /* ── Folder page ── */
  if (slug) {
    if (!folder) {
      return (
        <main className="cl-page">
          {bar}
          <section className="cl-hero">
            <div className="cl-wrap">
              <span className="cl-label">Content library</span>
              <h1 className="cl-h1">That folder <em>isn&rsquo;t here.</em></h1>
              <p className="cl-lede">It may have been renamed or moved in Drive. Every folder is listed on the library&rsquo;s front page.</p>
              <a className="cl-btn cl-btn--ink" href={HOME} onClick={go(HOME)} style={{ marginTop: 28 }}>All folders <Icon name="arrow-right" size={17} /></a>
            </div>
          </section>
          <LibraryFoot lib={lib} viewer={viewer} onSignOut={onSignOut} />
        </main>
      );
    }
    return (
      <FolderView folder={folder} foot={<LibraryFoot lib={lib} viewer={viewer} onSignOut={onSignOut} />} bar={bar} resultsView={resultsView} type={type} setType={setType} cols={cols}
        go={go} copy={copy} opener={opener} open={open} close={close} move={move} jump={jump} toast={toast} />
    );
  }

  /* ── Index ── */
  const list = lib.withMedia
    .filter((f) => (type === "image" ? f.photos : type === "video" ? f.videos : 1))
    .sort((a, b) => (sort === "az" ? a.title.localeCompare(b.title, "en", { numeric: true }) : (b.updated || "").localeCompare(a.updated || "")));

  return (
    <main className="cl-page" data-screen-label="Content library">
      {bar}
      {resultsView || (
        <>
          <section className="cl-hero">
            <div className="cl-wrap cl-hero__grid">
              <div>
                <span className="cl-label">For the marketing team</span>
                <h1 className="cl-h1">All our content, <em className="cl-nowrap">folder by folder.</em></h1>
                <p className="cl-lede">
                  Every photo and video in the Melsoft Content Drive. Open anything full size, download the
                  original, or copy its Drive link for a post or a brief.
                </p>
              </div>
              <dl className="cl-stats">
                <div><dd>{lib.withMedia.length}</dd><dt>Folders</dt></div>
                <div><dd>{nf.format(lib.photos)}</dd><dt>Photos</dt></div>
                <div><dd>{nf.format(lib.videos)}</dd><dt>Videos</dt></div>
              </dl>
            </div>
          </section>

          <section className="cl-section">
            <div className="cl-toolbar">
              <div className="cl-wrap cl-toolbar__in">
                <Tabs label="Show folders with" value={type} onChange={setType} tabs={[
                  { value: "all", label: "All folders", count: lib.withMedia.length },
                  { value: "image", label: "Photos", count: lib.withMedia.filter((f) => f.photos).length },
                  { value: "video", label: "Videos", count: lib.withMedia.filter((f) => f.videos).length },
                ]} />
                <div className="cl-sort" role="group" aria-label="Sort folders">
                  <span className="cl-sort__label">Sort</span>
                  {[["recent", "Recently updated"], ["az", "A–Z"]].map(([v, l]) => (
                    <button key={v} type="button" className={"cl-sort__btn" + (sort === v ? " is-on" : "")}
                      aria-pressed={sort === v} onClick={() => setSort(v)}>{l}</button>
                  ))}
                </div>
              </div>
            </div>
            <div className="cl-wrap">
              <ul className="cl-folders">
                {list.map((f, i) => <FolderCard key={f.id} folder={f} n={i + 1} navigate={navigate} type={type} />)}
              </ul>

              {lib.docsOnly.length > 0 && type === "all" && (
                <div className="cl-docs">
                  <div>
                    <span className="cl-label">Documents only</span>
                    <p>These folders hold briefs, PDFs or audio rather than photos and videos.</p>
                  </div>
                  <ul>
                    {lib.docsOnly.map((f) => (
                      <li key={f.id}>
                        <a href={f.url} target="_blank" rel="noopener noreferrer">
                          <span>{f.title}</span><i>{f.otherFiles ? plural(f.otherFiles, "file") : "Empty"}</i>
                          <Icon name="arrow-up-right" size={15} />
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </section>
        </>
      )}

      <LibraryFoot lib={lib} viewer={viewer} onSignOut={onSignOut} />

      {open && open.list[open.index] && (
        <Viewer items={open.list} index={open.index} onClose={close} onMove={move} onJump={jump} onCopy={copy} />
      )}
      {toast && <div className="cl-toast" role="status"><Icon name="check" size={16} /> {toast}</div>}
    </main>
  );
};

/* ── One folder: header, type tabs, subfolder rail, album sections ─── */
const FolderView = ({ folder, foot, bar, resultsView, type, setType, cols, go, copy, opener, open, close, move, jump, toast }) => {
  const sections = useMemo(() => folder.albums
    .map((a) => ({ album: a, items: a.items.filter(byType(type)) }))
    .filter((s) => s.items.length), [folder, type]);
  const flat = useMemo(() => sections.flatMap((s) => s.items), [sections]);
  const rows = useMemo(() => treeRows(folder.albums), [folder]);
  const counts = useMemo(() => new Map(sections.map((s) => [s.album.id, s.items.length])), [sections]);
  const multi = folder.albums.length > 1;
  const first = multi ? 12 : 48;
  const toAlbum = (id) => document.getElementById(`al-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });

  return (
    <main className="cl-page" data-screen-label="Content library folder">
      {bar}
      {resultsView || (
        <>
          <section className="cl-hero cl-hero--folder">
            <div className="cl-wrap">
              <nav className="cl-crumbs" aria-label="Breadcrumb">
                <a href={HOME} onClick={go(HOME)}><Icon name="chevron-left" size={15} /> Content library</a>
              </nav>
              <div className="cl-hero__grid">
                <div>
                  <h1 className="cl-h1 cl-h1--folder">{folder.title}</h1>
                  <p className="cl-hero__meta">
                    {countLine(folder.photos, folder.videos)}
                    {folder.subfolders > 0 && <> · {plural(folder.subfolders, "subfolder")}</>}
                    {folder.updated && <> · Updated {when(folder.updated)}</>}
                  </p>
                </div>
                <div className="cl-hero__actions">
                  <a className="cl-btn cl-btn--ink" href={folder.url} target="_blank" rel="noopener noreferrer">
                    Open in Drive <Icon name="arrow-up-right" size={16} />
                  </a>
                  <button type="button" className="cl-btn cl-btn--line" onClick={() => copy(folder.url)}>
                    <LinkIcon /> Copy folder link
                  </button>
                </div>
              </div>
              {folder.otherFiles > 0 && (
                <p className="cl-note">
                  Also in this folder: {plural(folder.otherFiles, "document, PDF or audio file", "documents, PDFs or audio files")}.
                  {" "}<a href={folder.url} target="_blank" rel="noopener noreferrer">Open them in Drive</a>.
                </p>
              )}
            </div>
          </section>

          <section className="cl-section cl-section--folder">
            <div className="cl-toolbar">
              <div className="cl-wrap cl-toolbar__in">
                <Tabs label="File type" value={type} onChange={setType} tabs={TYPE_TABS(folder.photos, folder.videos)} />
                {multi && (
                  <label className="cl-jump">
                    <span className="cl-sr">Jump to a subfolder</span>
                    <select value="" onChange={(e) => { if (e.target.value) toAlbum(e.target.value); }}>
                      <option value="">Jump to a subfolder…</option>
                      {sections.map((s) => <option key={s.album.id} value={s.album.id}>{s.album.label} ({s.items.length})</option>)}
                    </select>
                  </label>
                )}
              </div>
            </div>
            <div className="cl-wrap">
              <div className={"cl-body" + (multi ? " has-rail" : "")}>
                {multi && (
                  <nav className="cl-rail" aria-label="Subfolders">
                    <span className="cl-rail__h">Subfolders</span>
                    <ul>
                      {rows.map((r) => {
                        const n = r.album ? counts.get(r.album.id) || 0 : null;
                        return (
                          <li key={r.key} style={{ "--depth": r.depth }}>
                            {r.group ? (
                              <span className="cl-rail__group">{r.label}</span>
                            ) : (
                              <button type="button" className="cl-rail__btn" disabled={!n} onClick={() => toAlbum(r.album.id)}>
                                <span>{r.label}</span><i>{n}</i>
                              </button>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </nav>
                )}
                <div className="cl-albums">
                  {sections.map((s) => (
                    <Album key={s.album.id} album={s.album} items={s.items} first={first} cols={multi ? Math.max(2, cols - 1) : cols}
                      onOpen={opener(flat)} onCopy={copy} />
                  ))}
                  {!sections.length && <p className="cl-empty">No {type === "image" ? "photos" : "videos"} in this folder.</p>}
                </div>
              </div>
            </div>
          </section>
        </>
      )}

      {foot}

      {open && open.list[open.index] && (
        <Viewer items={open.list} index={open.index} onClose={close} onMove={move} onJump={jump} onCopy={copy} />
      )}
      {toast && <div className="cl-toast" role="status"><Icon name="check" size={16} /> {toast}</div>}
    </main>
  );
};

export default ContentLibraryPage;

import { useCallback, useEffect, useState } from "react";
import Library from "./Library";

/* Two kinds of page: the library ("/") and one folder ("/folders/<slug>").
   Anything else shows the library and tidies the address bar. */
const slugFrom = (path) => (path.match(/^\/folders\/([a-z0-9-]+)\/?$/) || [])[1] || null;

export default function App() {
  const [path, setPath] = useState(() => window.location.pathname);
  const slug = slugFrom(path);

  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    if (path !== "/" && !slug) window.history.replaceState(window.history.state, "", "/" + window.location.search);
  }, [path, slug]);

  const navigate = useCallback((to) => {
    if (to === window.location.pathname) {
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    window.history.pushState({}, "", to);
    setPath(to);
    window.scrollTo({ top: 0, behavior: "instant" });
  }, []);

  return <Library navigate={navigate} slug={slug} />;
}

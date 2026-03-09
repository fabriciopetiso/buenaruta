import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import {
  supabase,
  signIn,
  signUp,
  signOut,
  fetchRoutes,
  fetchRouteById,
  createRoute,
  toggleLike,
  addComment,
  toggleFollow,
  fetchFollowCounts,
  checkIsFollowing,
  fetchSavedRoutes,
  toggleSaveRoute,
  updateSavedRouteStatus,
  fetchProfile,
  fetchUserRoutes,
  subscribeToRoutes,
  subscribeToLikes,
  subscribeToComments,
} from "./lib/supabase";

// ── Leaflet loader ────────────────────────────────────────────────────────────
let leafletPromise = null;

const loadLeaflet = () => {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Leaflet solo funciona en navegador"));
  }
  if (window.L) return Promise.resolve(window.L);
  if (leafletPromise) return leafletPromise;

  leafletPromise = new Promise((resolve, reject) => {
    if (!document.querySelector('link[data-leaflet="true"]')) {
      const css = document.createElement("link");
      css.rel = "stylesheet";
      css.href = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css";
      css.dataset.leaflet = "true";
      document.head.appendChild(css);
    }

    const existing = document.querySelector('script[data-leaflet="true"]');
    if (existing) {
      if (window.L) return resolve(window.L);
      existing.addEventListener("load", () => resolve(window.L), { once: true });
      existing.addEventListener("error", () => {
        leafletPromise = null;
        reject(new Error("No se pudo cargar Leaflet"));
      }, { once: true });
      return;
    }

    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js";
    s.dataset.leaflet = "true";
    s.onload = () => resolve(window.L);
    s.onerror = () => {
      leafletPromise = null;
      reject(new Error("No se pudo cargar Leaflet"));
    };
    document.head.appendChild(s);
  });

  return leafletPromise;
};

// ── Constants ────────────────────────────────────────────────────────────────
const ROAD_TYPES = [
  { value: "asfalto", label: "Asfalto", color: "#22c55e" },
  { value: "ripio", label: "Ripio", color: "#f59e0b" },
  { value: "tierra", label: "Tierra/Huella", color: "#a16207" },
  { value: "mal_estado", label: "Mal estado", color: "#ef4444" },
  { value: "mixto", label: "Mixto", color: "#8b5cf6" },
];

const TYPE_META = {
  ruta: { label: "Ruta", icon: "🛣️", color: "#f59e0b" },
  viaje: { label: "Viaje", icon: "🧳", color: "#8b5cf6" },
  lugar: { label: "Lugar", icon: "📍", color: "#10b981" },
  evento: { label: "Evento", icon: "🎉", color: "#ef4444" },
};

const PLACE_TYPES = ["nafta", "mecánico", "mecánico de confianza", "camping", "comida", "mirador", "descanso", "otro"];

const EMPTY_FILTERS = {
  type: "all",
  tag: "",
  text: "",
  province: "",
  minLikes: "",
  minKm: "",
  maxKm: "",
  sortBy: "recent",
};

const EMPTY_NP = {
  type: "ruta",
  title: "",
  desc: "",
  tags: [],
  tagInput: "",
  points: [],
  segments: [],
  segmentGeometries: [],
  segmentKm: [],
  totalKm: 0,
  provinces: [],
  placeType: "",
  eventDate: "",
  computing: false,
  routeError: "",
};

const inp = {
  background: "#0f172a",
  border: "1px solid #334155",
  borderRadius: 8,
  color: "#f1f5f9",
  padding: "10px 12px",
  fontSize: 14,
  width: "100%",
  outline: "none",
  boxSizing: "border-box",
};

const btn = {
  background: "#f59e0b",
  color: "#0f172a",
  border: "none",
  borderRadius: 8,
  fontWeight: 700,
  cursor: "pointer",
  fontSize: 14,
};

const btn2 = { ...btn, background: "#1e293b", color: "#94a3b8" };

// ── Helpers ─────────────────────────────────────────────────────────────────
const normalizePoints = (pts) =>
  pts.map((p, i, arr) => ({
    ...p,
    label: i === 0 ? "Inicio" : i === arr.length - 1 && arr.length > 1 ? "Fin" : `Parada ${i}`,
  }));

const resetRouteDerived = (draft) => ({
  ...draft,
  segmentGeometries: [],
  segmentKm: [],
  totalKm: 0,
  provinces: [],
  computing: false,
  routeError: "",
});

const getRoadMeta = (value) => ROAD_TYPES.find((r) => r.value === value) || ROAD_TYPES[0];
const isRouteType = (type) => type === "ruta" || type === "viaje";
const isNavigableRoute = (post) => !!post && isRouteType(post.type) && Array.isArray(post.points) && post.points.length >= 2;

const getNavigatorLinks = (post) => {
  const pts = post.points || [];
  if (pts.length < 1) return {};
  const destination = pts[pts.length - 1];
  const waypoints = pts.slice(1, -1).map((p) => `${p.lat},${p.lng}`).join("|");
  return {
    google: `https://www.google.com/maps/dir/?api=1&destination=${destination.lat},${destination.lng}${waypoints ? `&waypoints=${encodeURIComponent(waypoints)}` : ""}&travelmode=driving`,
    waze: `https://waze.com/ul?ll=${destination.lat},${destination.lng}&navigate=yes`,
    geo: `geo:${destination.lat},${destination.lng}?q=${destination.lat},${destination.lng}`,
  };
};

const openExternalNavigator = (post, app) => {
  const links = getNavigatorLinks(post);
  window.open(links[app] || links.google, "_blank", "noopener,noreferrer");
};

// ── Transform DB data to UI format ───────────────────────────────────────────
const transformRoute = (dbRoute) => ({
  id: dbRoute.id,
  type: dbRoute.type,
  userId: dbRoute.user_id,
  title: dbRoute.title,
  desc: dbRoute.description,
  tags: dbRoute.tags || [],
  points: dbRoute.points || [],
  segments: dbRoute.segments || [],
  segmentGeometries: dbRoute.segment_geometries,
  segmentKm: dbRoute.segment_km,
  totalKm: dbRoute.total_km || 0,
  provinces: dbRoute.provinces || [],
  placeType: dbRoute.place_type,
  eventDate: dbRoute.event_date,
  createdAt: new Date(dbRoute.created_at).getTime(),
  likes: (dbRoute.route_likes || []).map(l => l.user_id),
  comments: (dbRoute.route_comments || []).map(c => ({
    id: c.id,
    userId: c.user_id,
    text: c.text,
    createdAt: new Date(c.created_at).getTime(),
    username: c.profiles?.username
  })),
  author: dbRoute.profiles ? {
    id: dbRoute.profiles.id,
    username: dbRoute.profiles.username,
    moto: dbRoute.profiles.moto_modelo ? {
      modelo: dbRoute.profiles.moto_modelo,
      cilindrada: dbRoute.profiles.moto_cilindrada,
      anio: dbRoute.profiles.moto_anio
    } : null
  } : null
});

// ── APIs ─────────────────────────────────────────────────────────────────────
const fetchSegmentRoute = async (p1, p2) => {
  const url = `https://router.project-osrm.org/route/v1/driving/${p1.lng},${p1.lat};${p2.lng},${p2.lat}?overview=full&geometries=geojson`;
  const r = await fetch(url);
  if (!r.ok) throw new Error("Error consultando el servicio de rutas");
  const data = await r.json();
  if (data.code !== "Ok") throw new Error("OSRM no encontró ruta entre esos puntos");
  return {
    geometry: data.routes[0].geometry.coordinates.map(([lng, lat]) => [lat, lng]),
    km: Math.round(data.routes[0].distance / 100) / 10,
  };
};

const fetchProvince = async (point) => {
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${point.lat}&lon=${point.lng}&format=json&accept-language=es`);
    if (!r.ok) return null;
    const data = await r.json();
    return data.address?.state || data.address?.province || data.address?.region || null;
  } catch {
    return null;
  }
};

// ── Hooks ────────────────────────────────────────────────────────────────────
function useOnScreen(ref, rootMargin = "150px") {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!ref.current || visible) return;
    const obs = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setVisible(true); obs.disconnect(); }
    }, { rootMargin });
    obs.observe(ref.current);
    return () => obs.disconnect();
  }, [ref, rootMargin, visible]);
  return visible;
}

function useDebouncedValue(value, delay = 250) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

// ── UI Components ────────────────────────────────────────────────────────────
function Avatar({ username, size = 32 }) {
  const initials = username ? username.slice(0, 2).toUpperCase() : "?";
  const hue = username ? (username.charCodeAt(0) * 7) % 360 : 200;
  return (
    <div style={{
      width: size, height: size, borderRadius: "50%",
      background: `hsl(${hue},55%,32%)`, color: "#fff",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontWeight: 700, fontSize: size * 0.38, flexShrink: 0,
    }}>
      {initials}
    </div>
  );
}

function Badge({ tag, onRemove }) {
  return (
    <span style={{
      background: "#1e293b", color: "#94a3b8", borderRadius: 99,
      padding: "2px 10px", fontSize: 12, display: "inline-flex", alignItems: "center", gap: 4,
    }}>
      #{tag}
      {onRemove && (
        <button onClick={onRemove} style={{ background: "none", border: "none", color: "#64748b", cursor: "pointer", padding: 0, lineHeight: 1 }}>×</button>
      )}
    </span>
  );
}

function RoadTypeBadge({ value }) {
  const rt = getRoadMeta(value);
  return <span style={{ background: rt.color + "22", color: rt.color, borderRadius: 99, padding: "2px 10px", fontSize: 12 }}>{rt.label}</span>;
}

function RouteSummary({ totalKm, provinces, segments, segmentKm }) {
  if (!totalKm && !provinces?.length) return null;
  const byType = {};
  (segments || []).forEach((s, i) => {
    const rt = typeof s === 'string' ? s : s.roadType;
    const km = segmentKm?.[i] || 0;
    byType[rt] = (byType[rt] || 0) + km;
  });

  return (
    <div style={{ background: "#0f172a", borderRadius: 10, padding: 12, marginTop: 10, marginBottom: 4 }}>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", marginBottom: Object.keys(byType).length ? 8 : 0 }}>
        {provinces?.length > 0 && <span style={{ color: "#94a3b8", fontSize: 13 }}>📍 {provinces.join(" → ")}</span>}
        {totalKm > 0 && <span style={{ color: "#f59e0b", fontSize: 13, fontWeight: 700 }}>🛣️ {totalKm} km totales</span>}
      </div>
      {Object.keys(byType).length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {Object.entries(byType).map(([type, km]) => {
            const rt = getRoadMeta(type);
            return <span key={type} style={{ background: rt.color + "22", color: rt.color, borderRadius: 99, padding: "2px 10px", fontSize: 12 }}>{rt.label}: {Math.round(km)} km</span>;
          })}
        </div>
      )}
    </div>
  );
}

function LoadingSpinner() {
  return (
    <div style={{ display: "flex", justifyContent: "center", alignItems: "center", padding: 40 }}>
      <div style={{
        width: 40, height: 40, border: "3px solid #334155",
        borderTopColor: "#f59e0b", borderRadius: "50%",
        animation: "spin 1s linear infinite"
      }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

// ── MiniMap ──────────────────────────────────────────────────────────────────
function MiniMap({ points, segmentGeometries, segmentTypes }) {
  const wrapperRef = useRef(null);
  const visible = useOnScreen(wrapperRef);
  const ref = useRef(null);
  const mapRef = useRef(null);
  const layersRef = useRef([]);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    loadLeaflet().then((L) => {
      if (cancelled || !ref.current || mapRef.current) return;
      const center = points?.length ? [points[0].lat, points[0].lng] : [-31.4, -64.18];
      const map = L.map(ref.current, {
        zoomControl: false, dragging: false, scrollWheelZoom: false,
        doubleClickZoom: false, touchZoom: false, boxZoom: false, keyboard: false,
      }).setView(center, 9);
      mapRef.current = map;
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "", maxZoom: 19 }).addTo(map);

      layersRef.current.forEach((l) => l.remove?.());
      layersRef.current = [];

      (points || []).forEach((p, i) => {
        const color = i === 0 ? "#22c55e" : i === points.length - 1 ? "#ef4444" : "#f59e0b";
        const icon = L.divIcon({
          html: `<div style="background:${color};width:10px;height:10px;border-radius:50%;border:2px solid #fff;box-shadow:0 1px 5px #0009"></div>`,
          iconSize: [10, 10], iconAnchor: [5, 5], className: "",
        });
        layersRef.current.push(L.marker([p.lat, p.lng], { icon }).addTo(map));
      });

      if (segmentGeometries?.length) {
        segmentGeometries.forEach((geo, i) => {
          if (!geo || geo.length < 2) return;
          const type = segmentTypes?.[i] || "asfalto";
          const rt = getRoadMeta(type);
          layersRef.current.push(L.polyline(geo, { color: rt.color, weight: 4, opacity: 0.9 }).addTo(map));
        });
      } else if (points?.length > 1) {
        layersRef.current.push(L.polyline(points.map((p) => [p.lat, p.lng]), { color: "#64748b", weight: 3, opacity: 0.5, dashArray: "8,6" }).addTo(map));
      }

      if (points?.length > 1) {
        map.fitBounds(L.latLngBounds(points.map((p) => [p.lat, p.lng])), { padding: [30, 30] });
      }
    }).catch(console.error);
    return () => { cancelled = true; };
  }, [visible, points, segmentGeometries, segmentTypes]);

  useEffect(() => {
    return () => {
      layersRef.current.forEach((l) => l.remove?.());
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }
    };
  }, []);

  return (
    <div ref={wrapperRef}>
      <div ref={ref} style={{ width: "100%", height: 160, borderRadius: "0 0 10px 10px", overflow: "hidden", marginTop: 10, border: "1px solid #334155", background: "#0f172a" }} />
    </div>
  );
}

// ── MapPicker ────────────────────────────────────────────────────────────────
function MapPicker({ points, onChange, readonly = false, segmentGeometries = [], segmentTypes = [] }) {
  const ref = useRef(null);
  const mapRef = useRef(null);
  const layersRef = useRef([]);
  const ptRef = useRef(points);
  ptRef.current = points;

  useEffect(() => {
    let cancelled = false;
    loadLeaflet().then((L) => {
      if (cancelled || !ref.current || mapRef.current) return;
      const center = points?.length ? [points[0].lat, points[0].lng] : [-31.4, -64.18];
      const map = L.map(ref.current).setView(center, 9);
      mapRef.current = map;
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: '© OSM', maxZoom: 19 }).addTo(map);

      if (!readonly) {
        map.on("click", (e) => {
          const updated = normalizePoints([...ptRef.current, { lat: e.latlng.lat, lng: e.latlng.lng }]);
          onChange(updated);
        });
      }
    }).catch(console.error);
    return () => { cancelled = true; };
  }, [readonly, onChange]);

  useEffect(() => {
    if (!mapRef.current || !window.L) return;
    const L = window.L;
    layersRef.current.forEach((l) => l.remove?.());
    layersRef.current = [];

    (points || []).forEach((p, i) => {
      const color = i === 0 ? "#22c55e" : i === points.length - 1 ? "#ef4444" : "#f59e0b";
      const icon = L.divIcon({
        html: `<div style="background:${color};width:14px;height:14px;border-radius:50%;border:2px solid #fff;box-shadow:0 1px 5px #0009"></div>`,
        iconSize: [14, 14], iconAnchor: [7, 7], className: "",
      });
      const m = L.marker([p.lat, p.lng], { icon, draggable: !readonly }).bindTooltip(p.label, { permanent: true, direction: "top", offset: [0, -10] }).addTo(mapRef.current);
      
      if (!readonly) {
        m.on("dragend", (e) => {
          const { lat, lng } = e.target.getLatLng();
          onChange(normalizePoints(ptRef.current.map((x, j) => (j === i ? { ...x, lat, lng } : x))));
        });
        m.on("contextmenu", () => {
          onChange(normalizePoints(ptRef.current.filter((_, j) => j !== i)));
        });
      }
      layersRef.current.push(m);
    });

    if (segmentGeometries?.length) {
      segmentGeometries.forEach((geo, i) => {
        if (!geo || geo.length < 2) return;
        const type = segmentTypes?.[i] || "asfalto";
        const rt = getRoadMeta(type);
        layersRef.current.push(L.polyline(geo, { color: rt.color, weight: 4, opacity: 0.9 }).addTo(mapRef.current));
      });
    } else if (points?.length > 1) {
      layersRef.current.push(L.polyline(points.map((p) => [p.lat, p.lng]), { color: "#64748b", weight: 3, opacity: 0.5, dashArray: "8,6" }).addTo(mapRef.current));
    }

    if (points?.length > 1) {
      mapRef.current.fitBounds(L.latLngBounds(points.map((p) => [p.lat, p.lng])), { padding: [30, 30] });
    } else if (points?.length === 1) {
      mapRef.current.setView([points[0].lat, points[0].lng], 12);
    }
  }, [points, segmentGeometries, segmentTypes, readonly, onChange]);

  useEffect(() => {
    return () => {
      layersRef.current.forEach((l) => l.remove?.());
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }
    };
  }, []);

  return <div ref={ref} style={{ width: "100%", height: 320, borderRadius: 10, overflow: "hidden", border: "1px solid #1e293b", background: "#0f172a" }} />;
}

// ── LocationSearch ───────────────────────────────────────────────────────────
function LocationSearch({ onSelect }) {
  const [q, setQ] = useState("");
  const [res, setRes] = useState([]);
  const [loading, setLoading] = useState(false);

  const search = async () => {
    if (!q.trim()) return;
    setLoading(true);
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=5&accept-language=es`);
      if (r.ok) setRes(await r.json());
    } catch {}
    setLoading(false);
  };

  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: "flex", gap: 6 }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && search()} placeholder="Buscar ciudad o lugar..." style={inp} />
        <button onClick={search} style={{ ...btn, padding: "8px 14px", flexShrink: 0 }}>{loading ? "…" : "🔍"}</button>
      </div>
      {res.length > 0 && (
        <div style={{ background: "#1e293b", borderRadius: 8, marginTop: 4, overflow: "hidden", maxHeight: 190, overflowY: "auto" }}>
          {res.map((r, i) => (
            <div key={i} onClick={() => { onSelect(parseFloat(r.lat), parseFloat(r.lon)); setRes([]); setQ(""); }}
              style={{ padding: "9px 12px", cursor: "pointer", fontSize: 13, color: "#cbd5e1", borderBottom: "1px solid #0f172a" }}
              onMouseEnter={(e) => e.currentTarget.style.background = "#0f172a"}
              onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}>
              📍 {r.display_name}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── SegmentEditor ────────────────────────────────────────────────────────────
function SegmentEditor({ points, segments, onChange }) {
  if (points.length < 2) return null;
  return (
    <div style={{ marginTop: 12 }}>
      <p style={{ color: "#64748b", fontSize: 13, marginBottom: 8 }}>🛣️ Tipo de camino por tramo</p>
      {points.slice(0, -1).map((p, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, background: "#1e293b", borderRadius: 8, padding: "8px 10px" }}>
          <span style={{ color: "#94a3b8", fontSize: 12, flex: 1 }}>{p.label} → {points[i + 1].label}</span>
          <select value={segments[i]?.roadType || "asfalto"} onChange={(e) => {
            const next = [...segments];
            next[i] = { ...next[i], roadType: e.target.value };
            onChange(next);
          }} style={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#f1f5f9", padding: "4px 8px", fontSize: 13 }}>
            {ROAD_TYPES.map((rt) => <option key={rt.value} value={rt.value}>{rt.label}</option>)}
          </select>
        </div>
      ))}
    </div>
  );
}

// ── PostCard ─────────────────────────────────────────────────────────────────
function PostCard({ post, currentUser, onLike, onComment, goProfile, goPostId, savedRoutes, onToggleSaved, onOpenNavigatorModal }) {
  const author = post.author;
  const meta = TYPE_META[post.type];
  const liked = !!(currentUser && post.likes?.includes(currentUser.id));
  const [showC, setShowC] = useState(false);
  const [cText, setCText] = useState("");
  const routePost = isRouteType(post.type);
  const hasMap = routePost && post.points?.length > 0;
  const saved = currentUser ? savedRoutes?.find((r) => r.route_id === post.id) : null;

  const segmentTypes = post.segments?.map(s => typeof s === 'string' ? s : s.roadType) || [];

  return (
    <div style={{ background: "#1e293b", borderRadius: 14, marginBottom: 12, overflow: "hidden" }}>
      <div style={{ padding: 16 }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 10 }}>
          <div onClick={() => goProfile(author?.id)} style={{ cursor: "pointer" }}>
            <Avatar username={author?.username} />
          </div>
          <div style={{ flex: 1 }}>
            <span style={{ color: "#f8fafc", fontWeight: 600, cursor: "pointer" }} onClick={() => goProfile(author?.id)}>@{author?.username}</span>
            {author?.moto && <span style={{ color: "#475569", fontSize: 11, marginLeft: 8 }}>🏍️ {author.moto.modelo}</span>}
            <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 2, flexWrap: "wrap" }}>
              <span style={{ background: meta.color + "22", color: meta.color, borderRadius: 99, padding: "1px 8px", fontSize: 12 }}>{meta.icon} {meta.label}</span>
              {post.totalKm > 0 && <span style={{ color: "#f59e0b", fontSize: 12, fontWeight: 700 }}>🛣️ {post.totalKm} km</span>}
              {post.likes?.length > 0 && <span style={{ color: "#64748b", fontSize: 12 }}>❤️ {post.likes.length}</span>}
              {saved && <span style={{ color: "#f59e0b", fontSize: 12 }}>⭐ Guardada</span>}
            </div>
          </div>
        </div>

        <h3 onClick={() => goPostId(post.id)} style={{ color: "#f1f5f9", margin: "0 0 4px", fontSize: 16, cursor: "pointer" }}>{post.title}</h3>
        <p style={{ color: "#94a3b8", fontSize: 14, margin: "0 0 8px", lineHeight: 1.5 }}>{post.desc}</p>

        {post.provinces?.length > 0 && <p style={{ color: "#64748b", fontSize: 12, margin: "0 0 8px" }}>📍 {post.provinces.join(" → ")}</p>}

        {post.segments?.length > 0 && (
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 8 }}>
            {[...new Set(segmentTypes)].map((rt) => <RoadTypeBadge key={rt} value={rt} />)}
          </div>
        )}

        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 10 }}>
          {(post.tags || []).map((t) => <Badge key={t} tag={t} />)}
        </div>

        <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
          <button onClick={() => currentUser && onLike(post.id)} style={{ background: "none", border: "none", color: liked ? "#ef4444" : "#64748b", cursor: "pointer", fontSize: 15, padding: 0 }}>
            {liked ? "❤️" : "🤍"} {post.likes?.length || 0}
          </button>
          <button onClick={() => setShowC((v) => !v)} style={{ background: "none", border: "none", color: "#64748b", cursor: "pointer", fontSize: 15, padding: 0 }}>
            💬 {post.comments?.length || 0}
          </button>
          {currentUser && isNavigableRoute(post) && (
            <button onClick={() => onToggleSaved(post.id)} style={{ background: "none", border: "none", color: saved ? "#f59e0b" : "#64748b", cursor: "pointer", fontSize: 15, padding: 0 }}>
              {saved ? "⭐ Guardada" : "⭐ Guardar"}
            </button>
          )}
          <button onClick={() => goPostId(post.id)} style={{ background: "none", border: "none", color: "#f59e0b", cursor: "pointer", fontSize: 13, padding: 0, marginLeft: "auto" }}>
            {hasMap ? "Ver ruta completa →" : "Ver detalle →"}
          </button>
        </div>

        {currentUser && isNavigableRoute(post) && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
            <button onClick={() => onOpenNavigatorModal(post.id)} style={{ ...btn, padding: "8px 12px" }}>🚀 Hacer esta ruta</button>
          </div>
        )}

        {showC && (
          <div style={{ marginTop: 12 }}>
            {(post.comments || []).map((c) => (
              <div key={c.id} style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                <Avatar username={c.username} size={24} />
                <div style={{ background: "#0f172a", borderRadius: 8, padding: "6px 10px", flex: 1 }}>
                  <span style={{ color: "#f59e0b", fontSize: 12, fontWeight: 600 }}>@{c.username}</span>
                  <p style={{ color: "#cbd5e1", fontSize: 13, margin: "2px 0 0" }}>{c.text}</p>
                </div>
              </div>
            ))}
            {currentUser && (
              <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                <input value={cText} onChange={(e) => setCText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && cText.trim() && (onComment(post.id, cText.trim()), setCText(""))}
                  placeholder="Comentar…" style={{ ...inp, flex: 1, padding: "6px 10px" }} />
                <button onClick={() => { if (cText.trim()) { onComment(post.id, cText.trim()); setCText(""); } }} style={{ ...btn, padding: "6px 12px" }}>↑</button>
              </div>
            )}
          </div>
        )}
      </div>

      {hasMap && <MiniMap points={post.points} segmentGeometries={post.segmentGeometries} segmentTypes={segmentTypes} />}
    </div>
  );
}

// ── NavigatorChooserModal ────────────────────────────────────────────────────
function NavigatorChooserModal({ post, onClose, onChooseApp }) {
  if (!post) return null;
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(2,6,23,0.7)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, zIndex: 2000 }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 420, background: "#1e293b", borderRadius: 16, padding: 16, border: "1px solid #334155" }}>
        <h3 style={{ margin: "0 0 8px", color: "#f8fafc" }}>🚀 Hacer esta ruta</h3>
        <p style={{ color: "#94a3b8", margin: "0 0 14px", fontSize: 14 }}>Elegí dónde abrir la navegación.</p>
        <div style={{ display: "grid", gap: 8 }}>
          <button onClick={() => onChooseApp("google")} style={{ ...btn, padding: 12 }}>Abrir en Google Maps</button>
          <button onClick={() => onChooseApp("waze")} style={{ ...btn2, padding: 12 }}>Abrir en Waze</button>
          <button onClick={() => onChooseApp("geo")} style={{ ...btn2, padding: 12 }}>Abrir en app del teléfono</button>
        </div>
        <button onClick={onClose} style={{ ...btn2, width: "100%", padding: 10, marginTop: 12 }}>Cancelar</button>
      </div>
    </div>
  );
}

// ── ProfileView Component ────────────────────────────────────────────────────
function ProfileView({ profileId, currentUser, routes, goBack, goPostId, handleLike, handleComment, savedRoutes, handleToggleSaved, setNavigatorPostId, handleLogout }) {
  const [profile, setProfile] = useState(null);
  const [userRoutes, setUserRoutes] = useState([]);
  const [followCounts, setFollowCounts] = useState({ followers: 0, following: 0 });
  const [isFollowingUser, setIsFollowingUser] = useState(false);
  const [profileLoading, setProfileLoading] = useState(true);

  useEffect(() => {
    const loadProfile = async () => {
      try {
        const p = await fetchProfile(profileId);
        setProfile(p);
        const routes = await fetchUserRoutes(profileId);
        setUserRoutes(routes.map(transformRoute));
        const counts = await fetchFollowCounts(profileId);
        setFollowCounts(counts);
        if (currentUser && currentUser.id !== profileId) {
          const following = await checkIsFollowing(currentUser.id, profileId);
          setIsFollowingUser(following);
        }
      } catch (err) {
        console.error(err);
      }
      setProfileLoading(false);
    };
    loadProfile();
  }, [profileId, currentUser]);

  if (profileLoading) return <LoadingSpinner />;
  if (!profile) return <p style={{ color: "#64748b" }}>Usuario no encontrado</p>;

  const isOwn = currentUser?.id === profile.id;

  const handleFollowToggle = async () => {
    if (!currentUser) return;
    await toggleFollow(currentUser.id, profileId);
    setIsFollowingUser(!isFollowingUser);
    const counts = await fetchFollowCounts(profileId);
    setFollowCounts(counts);
  };

  return (
    <>
      <button onClick={goBack} style={{ ...btn2, padding: "6px 12px", marginBottom: 14 }}>← Volver</button>

      <div style={{ textAlign: "center", marginBottom: 20 }}>
        <div style={{ display: "flex", justifyContent: "center" }}><Avatar username={profile.username} size={68} /></div>
        <h2 style={{ color: "#f1f5f9", margin: "10px 0 2px" }}>@{profile.username}</h2>
        {profile.moto_modelo && (
          <p style={{ color: "#f59e0b", fontSize: 14, margin: "0 0 10px" }}>🏍️ {profile.moto_modelo} · {profile.moto_cilindrada}cc · {profile.moto_anio}</p>
        )}

        <div style={{ display: "flex", justifyContent: "center", gap: 24, color: "#64748b", fontSize: 14, marginBottom: 14 }}>
          <span><strong style={{ color: "#f1f5f9" }}>{userRoutes.length}</strong> rutas</span>
          <span><strong style={{ color: "#f1f5f9" }}>{followCounts.followers}</strong> seguidores</span>
          <span><strong style={{ color: "#f1f5f9" }}>{followCounts.following}</strong> siguiendo</span>
        </div>

        {!isOwn && currentUser && (
          <button onClick={handleFollowToggle} style={{ ...(isFollowingUser ? btn2 : btn), padding: "8px 28px" }}>
            {isFollowingUser ? "Dejar de seguir" : "Seguir"}
          </button>
        )}

        {isOwn && <button onClick={handleLogout} style={{ ...btn2, padding: "8px 20px" }}>Cerrar sesión</button>}
      </div>

      <h3 style={{ color: "#94a3b8", fontSize: 14, marginBottom: 12 }}>Publicaciones de @{profile.username}</h3>

      {userRoutes.length === 0 ? (
        <p style={{ color: "#64748b" }}>Sin publicaciones aún.</p>
      ) : (
        userRoutes.map((p) => (
          <PostCard key={p.id} post={p} currentUser={currentUser} onLike={handleLike} onComment={handleComment}
            goProfile={() => {}} goPostId={goPostId} savedRoutes={savedRoutes} onToggleSaved={handleToggleSaved}
            onOpenNavigatorModal={(id) => setNavigatorPostId(id)} />
        ))
      )}
    </>
  );
}

// ── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [session, setSession] = useState(null);
  const [currentUser, setCurrentUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);

  const [routes, setRoutes] = useState([]);
  const [savedRoutes, setSavedRoutes] = useState([]);
  const [loading, setLoading] = useState(true);

  const [view, setView] = useState("feed");
  const [navStack, setNavStack] = useState([]);
  const [authMode, setAuthMode] = useState("login");
  const [authF, setAuthF] = useState({ email: "", username: "", pass: "", modelo: "", cilindrada: "", anio: "" });
  const [authErr, setAuthErr] = useState("");
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [np, setNp] = useState(EMPTY_NP);
  const [npStep, setNpStep] = useState(1);
  const [activePostId, setActivePostId] = useState(null);
  const [activeProfileId, setActiveProfileId] = useState(null);
  const [navigatorPostId, setNavigatorPostId] = useState(null);

  const debouncedText = useDebouncedValue(filters.text, 250);
  const routeReqIdRef = useRef(0);

  // ─── Auth setup ────────────────────────────────────────────────────────────
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session?.user) {
        fetchProfile(session.user.id).then(setCurrentUser).catch(console.error);
      }
      setAuthLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (session?.user) {
        fetchProfile(session.user.id).then(setCurrentUser).catch(console.error);
      } else {
        setCurrentUser(null);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  // ─── Load routes ───────────────────────────────────────────────────────────
  useEffect(() => {
    const loadData = async () => {
      try {
        const data = await fetchRoutes();
        setRoutes(data.map(transformRoute));
      } catch (err) {
        console.error("Error loading routes:", err);
      }
      setLoading(false);
    };
    loadData();

    const routesSub = subscribeToRoutes((payload) => {
      if (payload.eventType === 'INSERT') {
        fetchRouteById(payload.new.id).then(r => {
          setRoutes(prev => [transformRoute(r), ...prev]);
        });
      } else if (payload.eventType === 'DELETE') {
        setRoutes(prev => prev.filter(r => r.id !== payload.old.id));
      }
    });

    const likesSub = subscribeToLikes(() => {
      fetchRoutes().then(data => setRoutes(data.map(transformRoute)));
    });

    const commentsSub = subscribeToComments(() => {
      fetchRoutes().then(data => setRoutes(data.map(transformRoute)));
    });

    return () => {
      routesSub.unsubscribe();
      likesSub.unsubscribe();
      commentsSub.unsubscribe();
    };
  }, []);

  // ─── Load saved routes ─────────────────────────────────────────────────────
  useEffect(() => {
    if (currentUser) {
      fetchSavedRoutes(currentUser.id).then(setSavedRoutes).catch(console.error);
    } else {
      setSavedRoutes([]);
    }
  }, [currentUser]);

  // ─── Navigation ────────────────────────────────────────────────────────────
  const openView = (nextView, payloadFn) => {
    setNavStack((prev) => [...prev, view]);
    payloadFn?.();
    setView(nextView);
  };

  const goBack = () => {
    setNavStack((prev) => {
      const next = [...prev];
      const last = next.pop();
      setView(last || "feed");
      return next;
    });
  };

  const goProfile = (id) => openView("profile", () => setActiveProfileId(id));
  const goPostId = (id) => openView("post", () => setActivePostId(id));

  // ─── Auth handlers ─────────────────────────────────────────────────────────
  const handleAuth = async () => {
    setAuthErr("");
    try {
      if (authMode === "login") {
        await signIn(authF.email, authF.pass);
      } else {
        if (!authF.email || !authF.username || !authF.pass) {
          setAuthErr("Completá todos los campos");
          return;
        }
        if (!authF.modelo || !authF.cilindrada || !authF.anio) {
          setAuthErr("Completá los datos de tu moto");
          return;
        }
        await signUp(authF.email, authF.pass, authF.username, {
          modelo: authF.modelo,
          cilindrada: authF.cilindrada,
          anio: authF.anio
        });
        setAuthErr("¡Revisá tu email para confirmar la cuenta!");
        return;
      }
      setAuthF({ email: "", username: "", pass: "", modelo: "", cilindrada: "", anio: "" });
      setView("feed");
      setNavStack([]);
    } catch (err) {
      setAuthErr(err.message || "Error de autenticación");
    }
  };

  const handleLogout = async () => {
    await signOut();
    setView("feed");
    setNavStack([]);
  };

  // ─── Route actions ─────────────────────────────────────────────────────────
  const handleLike = async (routeId) => {
    if (!currentUser) return;
    try {
      await toggleLike(routeId, currentUser.id);
      const data = await fetchRoutes();
      setRoutes(data.map(transformRoute));
    } catch (err) {
      console.error("Error toggling like:", err);
    }
  };

  const handleComment = async (routeId, text) => {
    if (!currentUser) return;
    try {
      await addComment(routeId, currentUser.id, text);
      const data = await fetchRoutes();
      setRoutes(data.map(transformRoute));
    } catch (err) {
      console.error("Error adding comment:", err);
    }
  };

  const handleToggleSaved = async (routeId) => {
    if (!currentUser) return;
    try {
      await toggleSaveRoute(currentUser.id, routeId);
      const saved = await fetchSavedRoutes(currentUser.id);
      setSavedRoutes(saved);
    } catch (err) {
      console.error("Error toggling saved:", err);
    }
  };

  // ─── Create route ──────────────────────────────────────────────────────────
  const updatePoints = (pts) => {
    const segCount = Math.max(0, pts.length - 1);
    const segs = Array.from({ length: segCount }, (_, i) => np.segments[i] || { roadType: "asfalto" });
    setNp((prev) => resetRouteDerived({ ...prev, points: pts, segments: segs }));
  };

  const computeRoute = async () => {
    if (np.points.length < 2) return;
    const reqId = ++routeReqIdRef.current;
    setNp((prev) => ({ ...prev, computing: true, routeError: "" }));

    try {
      const geometries = [];
      const kms = [];
      for (let i = 0; i < np.points.length - 1; i++) {
        const result = await fetchSegmentRoute(np.points[i], np.points[i + 1]);
        if (reqId !== routeReqIdRef.current) return;
        geometries.push(result.geometry);
        kms.push(result.km);
      }

      const provinceResults = await Promise.all(np.points.map(fetchProvince));
      if (reqId !== routeReqIdRef.current) return;

      const provinces = [...new Set(provinceResults.filter(Boolean))];
      const totalKm = Math.round(kms.reduce((a, b) => a + b, 0) * 10) / 10;

      setNp((prev) => ({
        ...prev,
        segmentGeometries: geometries,
        segmentKm: kms,
        totalKm,
        provinces,
        computing: false,
        routeError: "",
      }));
    } catch (e) {
      if (reqId !== routeReqIdRef.current) return;
      setNp((prev) => ({ ...prev, computing: false, routeError: e.message || "No se pudo calcular la ruta." }));
    }
  };

  const submitPost = async () => {
    if (!currentUser || !np.title.trim() || np.points.length === 0) return;

    try {
      await createRoute({
        user_id: currentUser.id,
        type: np.type,
        title: np.title,
        description: np.desc,
        tags: np.tags,
        points: np.points,
        segments: np.segments,
        segment_geometries: np.segmentGeometries,
        segment_km: np.segmentKm,
        total_km: np.totalKm,
        provinces: np.provinces,
        place_type: np.type === "lugar" ? np.placeType : null,
        event_date: np.type === "evento" ? np.eventDate : null,
      });

      setNp(EMPTY_NP);
      setNpStep(1);
      setView("feed");
      setNavStack([]);
    } catch (err) {
      console.error("Error creating route:", err);
    }
  };

  // ─── Filtering ─────────────────────────────────────────────────────────────
  const filteredRoutes = useMemo(() => {
    const minLikes = filters.minLikes === "" ? null : Number(filters.minLikes);
    const minKm = filters.minKm === "" ? null : Number(filters.minKm);
    const maxKm = filters.maxKm === "" ? null : Number(filters.maxKm);

    return routes
      .filter((p) => {
        if (filters.type !== "all" && p.type !== filters.type) return false;
        if (filters.tag && !p.tags?.some((t) => t.toLowerCase().includes(filters.tag.toLowerCase()))) return false;
        if (debouncedText && !p.title.toLowerCase().includes(debouncedText.toLowerCase()) && !p.desc?.toLowerCase().includes(debouncedText.toLowerCase())) return false;
        if (filters.province && !(p.provinces || []).some((prov) => prov.toLowerCase() === filters.province.toLowerCase())) return false;
        if (minLikes !== null && (p.likes?.length || 0) < minLikes) return false;
        if (minKm !== null && (p.totalKm || 0) < minKm) return false;
        if (maxKm !== null && (p.totalKm || 0) > maxKm) return false;
        return true;
      })
      .sort((a, b) => {
        if (filters.sortBy === "likes") return (b.likes?.length || 0) - (a.likes?.length || 0);
        if (filters.sortBy === "km") return (b.totalKm || 0) - (a.totalKm || 0);
        return b.createdAt - a.createdAt;
      });
  }, [routes, filters, debouncedText]);

  const allTags = useMemo(() => [...new Set(routes.flatMap((p) => p.tags || []))], [routes]);
  const allProvinces = useMemo(() => [...new Set(routes.flatMap((p) => p.provinces || []).filter(Boolean))].sort(), [routes]);

  const navigatorPost = navigatorPostId ? routes.find((p) => p.id === navigatorPostId) : null;
  const draftIsRoute = isRouteType(np.type);
  const routeComputed = np.segmentGeometries.length > 0;
  const canPublish = !!np.title.trim() && np.points.length > 0 && !(np.type === "lugar" && !np.placeType) && !(np.type === "evento" && !np.eventDate) && !(draftIsRoute && np.points.length >= 2 && !routeComputed);

  const inNav = !["auth", "new", "post", "profile"].includes(view);

  if (authLoading) {
    return (
      <div style={{ background: "#0f172a", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <LoadingSpinner />
      </div>
    );
  }

  return (
    <div style={{ background: "#0f172a", minHeight: "100vh", color: "#f1f5f9", fontFamily: "system-ui,sans-serif", maxWidth: 480, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ background: "#1e293b", padding: "12px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, zIndex: 100, borderBottom: "1px solid #334155" }}>
        <span style={{ fontWeight: 800, fontSize: 20, color: "#f59e0b", cursor: "pointer" }} onClick={() => { setView("feed"); setNavStack([]); }}>🏍️ BuenaRuta</span>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {currentUser ? (
            <>
              <button onClick={() => { openView("new", () => { setNp(EMPTY_NP); setNpStep(1); }); }} style={{ ...btn, padding: "6px 12px", fontSize: 13 }}>+ Publicar</button>
              <div onClick={() => goProfile(currentUser.id)} style={{ cursor: "pointer" }}><Avatar username={currentUser.username} size={30} /></div>
            </>
          ) : (
            <button onClick={() => openView("auth")} style={{ ...btn, padding: "6px 14px" }}>Entrar</button>
          )}
        </div>
      </div>

      {/* Nav tabs */}
      {inNav && (
        <div style={{ display: "flex", background: "#1e293b", borderBottom: "2px solid #0f172a" }}>
          {[["feed", "🏠 Home"], ["explore", "🔍 Explorar"]].map(([v, l]) => (
            <button key={v} onClick={() => { setView(v); setNavStack([]); }} style={{
              flex: 1, padding: "10px 0", background: "none", border: "none",
              borderBottom: view === v ? "2px solid #f59e0b" : "2px solid transparent",
              color: view === v ? "#f59e0b" : "#64748b", fontWeight: view === v ? 700 : 400, cursor: "pointer", fontSize: 14,
            }}>{l}</button>
          ))}
        </div>
      )}

      <div style={{ padding: 16, paddingBottom: 90 }}>
        {/* Auth View */}
        {view === "auth" && (
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
              <button onClick={goBack} style={{ ...btn2, padding: "6px 10px" }}>←</button>
              <h2 style={{ margin: 0, color: "#f59e0b" }}>{authMode === "login" ? "Iniciar sesión" : "Crear cuenta"}</h2>
            </div>

            {authMode === "register" && (
              <>
                <input placeholder="Nombre de usuario" style={{ ...inp, marginBottom: 10 }} value={authF.username} onChange={(e) => setAuthF({ ...authF, username: e.target.value })} />
                <div style={{ border: "1px solid #334155", borderRadius: 10, padding: 12, marginBottom: 10 }}>
                  <p style={{ color: "#64748b", fontSize: 13, margin: "0 0 8px" }}>🏍️ Tu moto (obligatorio)</p>
                  <input placeholder="Modelo (ej: Honda CB 500)" style={{ ...inp, marginBottom: 8 }} value={authF.modelo} onChange={(e) => setAuthF({ ...authF, modelo: e.target.value })} />
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    <input placeholder="Cilindrada (cc)" type="number" style={inp} value={authF.cilindrada} onChange={(e) => setAuthF({ ...authF, cilindrada: e.target.value })} />
                    <input placeholder="Año" type="number" style={inp} value={authF.anio} onChange={(e) => setAuthF({ ...authF, anio: e.target.value })} />
                  </div>
                </div>
              </>
            )}

            <input placeholder="Email" type="email" style={{ ...inp, marginBottom: 10 }} value={authF.email} onChange={(e) => setAuthF({ ...authF, email: e.target.value })} />
            <input placeholder="Contraseña" type="password" style={{ ...inp, marginBottom: 10 }} value={authF.pass} onChange={(e) => setAuthF({ ...authF, pass: e.target.value })} onKeyDown={(e) => e.key === "Enter" && handleAuth()} />

            {authErr && <p style={{ color: authErr.includes("Revisá") ? "#22c55e" : "#ef4444", fontSize: 13, marginBottom: 8 }}>{authErr}</p>}

            <button onClick={handleAuth} style={{ ...btn, width: "100%", padding: 12 }}>{authMode === "login" ? "Entrar" : "Registrarme"}</button>

            <p style={{ color: "#64748b", textAlign: "center", marginTop: 14, fontSize: 14 }}>
              {authMode === "login" ? "¿No tenés cuenta? " : "¿Ya tenés cuenta? "}
              <span style={{ color: "#f59e0b", cursor: "pointer" }} onClick={() => setAuthMode(authMode === "login" ? "register" : "login")}>
                {authMode === "login" ? "Registrate" : "Iniciá sesión"}
              </span>
            </p>

            <p style={{ color: "#475569", fontSize: 12, textAlign: "center", marginTop: 12 }}>Demo: moto@example.com / 1234</p>
          </div>
        )}

        {/* Feed View */}
        {view === "feed" && (
          <div>
            {loading ? <LoadingSpinner /> : (
              <>
                <div style={{ background: "#1e293b", borderRadius: 14, padding: 12, marginBottom: 16, border: "1px solid #334155" }}>
                  <input placeholder="Buscar rutas..." style={{ ...inp, marginBottom: 10 }} value={filters.text} onChange={(e) => setFilters(prev => ({ ...prev, text: e.target.value }))} />
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {[{ value: "recent", label: "Recientes" }, { value: "likes", label: "Más likes" }, { value: "km", label: "Más km" }].map((opt) => (
                      <button key={opt.value} onClick={() => setFilters(prev => ({ ...prev, sortBy: opt.value }))} style={{
                        ...btn2, padding: "6px 12px", borderRadius: 99,
                        background: filters.sortBy === opt.value ? "#f59e0b" : "#0f172a",
                        color: filters.sortBy === opt.value ? "#0f172a" : "#94a3b8",
                      }}>{opt.label}</button>
                    ))}
                  </div>
                </div>

                {currentUser && savedRoutes.length > 0 && (
                  <div style={{ background: "#1e293b", borderRadius: 12, padding: 12, marginBottom: 14 }}>
                    <h3 style={{ margin: "0 0 10px", color: "#f1f5f9", fontSize: 16 }}>⭐ Mis rutas guardadas ({savedRoutes.length})</h3>
                    {savedRoutes.slice(0, 3).map((saved) => {
                      const route = routes.find(r => r.id === saved.route_id);
                      if (!route) return null;
                      return (
                        <div key={saved.route_id} onClick={() => goPostId(route.id)} style={{ background: "#0f172a", borderRadius: 10, padding: 10, marginBottom: 8, cursor: "pointer", border: "1px solid #334155" }}>
                          <div style={{ color: "#f1f5f9", fontWeight: 600 }}>{route.title}</div>
                          <div style={{ color: "#64748b", fontSize: 12 }}>{route.totalKm} km · {route.provinces?.join(", ")}</div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {filteredRoutes.length === 0 ? (
                  <p style={{ color: "#64748b", textAlign: "center", marginTop: 30 }}>No hay rutas todavía. ¡Sé el primero en publicar!</p>
                ) : (
                  filteredRoutes.map((p) => (
                    <PostCard key={p.id} post={p} currentUser={currentUser} onLike={handleLike} onComment={handleComment}
                      goProfile={goProfile} goPostId={goPostId} savedRoutes={savedRoutes} onToggleSaved={handleToggleSaved}
                      onOpenNavigatorModal={(id) => setNavigatorPostId(id)} />
                  ))
                )}

                {!currentUser && (
                  <div style={{ background: "#1e293b", borderRadius: 12, padding: 16, marginTop: 8, textAlign: "center", border: "1px solid #334155" }}>
                    <p style={{ color: "#94a3b8", marginBottom: 10 }}>Creá tu cuenta para publicar y guardar rutas.</p>
                    <button onClick={() => openView("auth")} style={{ ...btn, padding: "10px 24px" }}>Crear cuenta gratis</button>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* Explore View */}
        {view === "explore" && (
          <div>
            <div style={{ background: "#1e293b", borderRadius: 12, padding: 12, marginBottom: 14 }}>
              <input placeholder="🔍 Buscar..." style={{ ...inp, marginBottom: 10 }} value={filters.text} onChange={(e) => setFilters(prev => ({ ...prev, text: e.target.value }))} />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 10 }}>
                <select style={inp} value={filters.type} onChange={(e) => setFilters(prev => ({ ...prev, type: e.target.value }))}>
                  <option value="all">Todos los tipos</option>
                  <option value="ruta">🛣️ Ruta</option>
                  <option value="viaje">🧳 Viaje</option>
                  <option value="lugar">📍 Lugar</option>
                  <option value="evento">🎉 Evento</option>
                </select>
                <select style={inp} value={filters.province} onChange={(e) => setFilters(prev => ({ ...prev, province: e.target.value }))}>
                  <option value="">Todas las provincias</option>
                  {allProvinces.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              {allTags.length > 0 && (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {allTags.slice(0, 10).map((t) => (
                    <span key={t} onClick={() => setFilters(prev => ({ ...prev, tag: prev.tag === t ? "" : t }))} style={{
                      background: filters.tag === t ? "#f59e0b22" : "#0f172a", color: filters.tag === t ? "#f59e0b" : "#64748b",
                      borderRadius: 99, padding: "3px 10px", fontSize: 12, cursor: "pointer", border: `1px solid ${filters.tag === t ? "#f59e0b" : "#334155"}`,
                    }}>#{t}</span>
                  ))}
                </div>
              )}
            </div>

            {filteredRoutes.length === 0 ? (
              <p style={{ color: "#64748b", textAlign: "center", marginTop: 30 }}>Sin resultados.</p>
            ) : (
              filteredRoutes.map((p) => (
                <PostCard key={p.id} post={p} currentUser={currentUser} onLike={handleLike} onComment={handleComment}
                  goProfile={goProfile} goPostId={goPostId} savedRoutes={savedRoutes} onToggleSaved={handleToggleSaved}
                  onOpenNavigatorModal={(id) => setNavigatorPostId(id)} />
              ))
            )}
          </div>
        )}

        {/* New Post View */}
        {view === "new" && currentUser && (
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
              <button onClick={goBack} style={{ ...btn2, padding: "6px 10px" }}>←</button>
              <h2 style={{ margin: 0, color: "#f59e0b" }}>Nueva publicación</h2>
              <span style={{ marginLeft: "auto", color: "#64748b", fontSize: 13 }}>Paso {npStep}/2</span>
            </div>

            {npStep === 1 && (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 14 }}>
                  {Object.entries(TYPE_META).map(([k, v]) => (
                    <button key={k} onClick={() => setNp(prev => ({ ...prev, type: k }))} style={{
                      background: np.type === k ? v.color + "22" : "#1e293b",
                      border: `2px solid ${np.type === k ? v.color : "#334155"}`,
                      borderRadius: 10, padding: 14, cursor: "pointer",
                      color: np.type === k ? v.color : "#94a3b8", fontWeight: 600, fontSize: 15,
                    }}>{v.icon} {v.label}</button>
                  ))}
                </div>

                <input placeholder="Título *" style={{ ...inp, marginBottom: 10 }} value={np.title} onChange={(e) => setNp(prev => ({ ...prev, title: e.target.value }))} />
                <textarea placeholder="Descripción" style={{ ...inp, marginBottom: 10, minHeight: 76, resize: "vertical" }} value={np.desc} onChange={(e) => setNp(prev => ({ ...prev, desc: e.target.value }))} />

                {np.type === "lugar" && (
                  <select style={{ ...inp, marginBottom: 10 }} value={np.placeType} onChange={(e) => setNp(prev => ({ ...prev, placeType: e.target.value }))}>
                    <option value="">Tipo de lugar *</option>
                    {PLACE_TYPES.map((t) => <option key={t}>{t}</option>)}
                  </select>
                )}

                {np.type === "evento" && (
                  <input type="date" style={{ ...inp, marginBottom: 10 }} value={np.eventDate} onChange={(e) => setNp(prev => ({ ...prev, eventDate: e.target.value }))} />
                )}

                <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
                  <input placeholder="Etiqueta + Enter" style={{ ...inp, flex: 1 }} value={np.tagInput}
                    onChange={(e) => setNp(prev => ({ ...prev, tagInput: e.target.value }))}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        const tag = np.tagInput.trim().toLowerCase();
                        if (tag && !np.tags.includes(tag)) setNp(prev => ({ ...prev, tags: [...prev.tags, tag], tagInput: "" }));
                      }
                    }} />
                  <button onClick={() => {
                    const tag = np.tagInput.trim().toLowerCase();
                    if (tag && !np.tags.includes(tag)) setNp(prev => ({ ...prev, tags: [...prev.tags, tag], tagInput: "" }));
                  }} style={{ ...btn2, padding: "8px 12px" }}>+</button>
                </div>

                <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 16 }}>
                  {np.tags.map((t) => <Badge key={t} tag={t} onRemove={() => setNp(prev => ({ ...prev, tags: prev.tags.filter(x => x !== t) }))} />)}
                </div>

                <button onClick={() => setNpStep(2)} disabled={!np.title.trim()} style={{ ...btn, width: "100%", padding: 12, opacity: !np.title.trim() ? 0.5 : 1 }}>
                  Siguiente: Mapa →
                </button>
              </>
            )}

            {npStep === 2 && (
              <>
                <LocationSearch onSelect={(lat, lng) => updatePoints(normalizePoints([...np.points, { lat, lng }]))} />
                <p style={{ color: "#64748b", fontSize: 12, marginBottom: 6 }}>Tocá el mapa para agregar puntos</p>
                <MapPicker points={np.points} onChange={updatePoints} segmentGeometries={np.segmentGeometries} segmentTypes={np.segments.map(s => s.roadType)} />

                {draftIsRoute && <SegmentEditor points={np.points} segments={np.segments} onChange={(segs) => setNp(prev => resetRouteDerived({ ...prev, segments: segs }))} />}

                {draftIsRoute && np.points.length >= 2 && (
                  <button onClick={computeRoute} disabled={np.computing} style={{ ...btn2, width: "100%", padding: 10, marginTop: 10, opacity: np.computing ? 0.6 : 1 }}>
                    {np.computing ? "⏳ Calculando..." : routeComputed ? "🔄 Recalcular ruta" : "📐 Calcular ruta *"}
                  </button>
                )}

                {np.routeError && <p style={{ color: "#ef4444", fontSize: 13, marginTop: 6, textAlign: "center" }}>⚠️ {np.routeError}</p>}
                {routeComputed && <RouteSummary totalKm={np.totalKm} provinces={np.provinces} segments={np.segments} segmentKm={np.segmentKm} />}

                <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 8 }}>
                  {np.points.map((p, i) => (
                    <span key={i} style={{ background: "#1e293b", color: "#94a3b8", borderRadius: 99, padding: "3px 10px", fontSize: 12 }}>
                      {i === 0 ? "🟢" : i === np.points.length - 1 ? "🔴" : "🟡"} {p.label}
                    </span>
                  ))}
                </div>

                {np.points.length > 0 && (
                  <button onClick={() => setNp(prev => resetRouteDerived({ ...prev, points: [], segments: [] }))} style={{ ...btn2, marginTop: 8, padding: "6px 12px", fontSize: 12 }}>
                    🗑 Limpiar puntos
                  </button>
                )}

                <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
                  <button onClick={() => setNpStep(1)} style={{ ...btn2, flex: 1, padding: 12 }}>← Volver</button>
                  <button onClick={submitPost} disabled={!canPublish} style={{ ...btn, flex: 2, padding: 12, opacity: !canPublish ? 0.5 : 1 }}>Publicar 🏍️</button>
                </div>

                {draftIsRoute && np.points.length >= 2 && !routeComputed && (
                  <p style={{ color: "#64748b", fontSize: 12, textAlign: "center", marginTop: 8 }}>* Calculá la ruta antes de publicar</p>
                )}
              </>
            )}
          </div>
        )}

        {/* Post Detail View */}
        {view === "post" && activePostId && (() => {
          const post = routes.find(r => r.id === activePostId);
          if (!post) return <p style={{ color: "#64748b" }}>Ruta no encontrada</p>;
          const segmentTypes = post.segments?.map(s => typeof s === 'string' ? s : s.roadType) || [];

          return (
            <>
              <button onClick={goBack} style={{ ...btn2, padding: "6px 12px", marginBottom: 14 }}>← Volver</button>

              <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 12 }}>
                <div onClick={() => goProfile(post.author?.id)} style={{ cursor: "pointer" }}><Avatar username={post.author?.username} size={42} /></div>
                <div>
                  <span style={{ color: "#f8fafc", fontWeight: 700, cursor: "pointer" }} onClick={() => goProfile(post.author?.id)}>@{post.author?.username}</span>
                  {post.author?.moto && <p style={{ color: "#f59e0b", fontSize: 12, margin: "2px 0 0" }}>🏍️ {post.author.moto.modelo}</p>}
                </div>
              </div>

              <h2 style={{ color: "#f1f5f9", marginBottom: 6 }}>{post.title}</h2>
              <p style={{ color: "#94a3b8", marginBottom: 12, lineHeight: 1.6 }}>{post.desc}</p>

              <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 12 }}>
                {(post.tags || []).map((t) => <Badge key={t} tag={t} />)}
              </div>

              {isRouteType(post.type) && post.totalKm > 0 && (
                <RouteSummary totalKm={post.totalKm} provinces={post.provinces} segments={post.segments} segmentKm={post.segmentKm} />
              )}

              {currentUser && isNavigableRoute(post) && (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 16 }}>
                  <button onClick={() => handleToggleSaved(post.id)} style={{ ...btn, padding: "10px 14px" }}>
                    {savedRoutes.find(r => r.route_id === post.id) ? "⭐ Guardada" : "⭐ Guardar ruta"}
                  </button>
                  <button onClick={() => setNavigatorPostId(post.id)} style={{ ...btn2, padding: "10px 14px" }}>🚀 Hacer esta ruta</button>
                </div>
              )}

              <div style={{ marginTop: 12 }}>
                <MapPicker points={post.points} onChange={() => {}} readonly segmentGeometries={post.segmentGeometries} segmentTypes={segmentTypes} />
              </div>

              <div style={{ marginTop: 16 }}>
                <h4 style={{ color: "#64748b", fontWeight: 600, marginBottom: 10 }}>💬 Comentarios ({post.comments?.length || 0})</h4>
                {(post.comments || []).map((c) => (
                  <div key={c.id} style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                    <Avatar username={c.username} size={28} />
                    <div style={{ background: "#1e293b", borderRadius: 10, padding: "8px 12px", flex: 1 }}>
                      <span style={{ color: "#f59e0b", fontSize: 12, fontWeight: 600 }}>@{c.username}</span>
                      <p style={{ color: "#cbd5e1", fontSize: 14, margin: "4px 0 0" }}>{c.text}</p>
                    </div>
                  </div>
                ))}
                {currentUser && (
                  <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                    <input id="comment-input" placeholder="Escribí un comentario..." style={{ ...inp, flex: 1 }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && e.target.value.trim()) {
                          handleComment(post.id, e.target.value.trim());
                          e.target.value = "";
                        }
                      }} />
                    <button onClick={() => {
                      const input = document.getElementById("comment-input");
                      if (input?.value.trim()) { handleComment(post.id, input.value.trim()); input.value = ""; }
                    }} style={{ ...btn, padding: "8px 14px" }}>↑</button>
                  </div>
                )}
              </div>
            </>
          );
        })()}

        {/* Profile View */}
        {view === "profile" && activeProfileId && (
          <ProfileView
            profileId={activeProfileId}
            currentUser={currentUser}
            routes={routes}
            goBack={goBack}
            goPostId={goPostId}
            handleLike={handleLike}
            handleComment={handleComment}
            savedRoutes={savedRoutes}
            handleToggleSaved={handleToggleSaved}
            setNavigatorPostId={setNavigatorPostId}
            handleLogout={handleLogout}
          />
        )}
      </div>

      {/* Navigator Modal */}
      {navigatorPost && (
        <NavigatorChooserModal post={navigatorPost} onClose={() => setNavigatorPostId(null)}
          onChooseApp={(app) => { openExternalNavigator(navigatorPost, app); setNavigatorPostId(null); }} />
      )}
    </div>
  );
}

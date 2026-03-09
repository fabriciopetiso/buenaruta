import React, { useEffect, useMemo, useRef, useState } from "react";

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
      css.href =
        "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css";
      css.dataset.leaflet = "true";
      document.head.appendChild(css);
    }

    const existing = document.querySelector('script[data-leaflet="true"]');
    if (existing) {
      if (window.L) return resolve(window.L);
      existing.addEventListener("load", () => resolve(window.L), { once: true });
      existing.addEventListener(
        "error",
        () => {
          leafletPromise = null;
          reject(new Error("No se pudo cargar Leaflet"));
        },
        { once: true }
      );
      return;
    }

    const s = document.createElement("script");
    s.src =
      "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js";
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

const PLACE_TYPES = [
  "nafta",
  "mecánico",
  "mecánico de confianza",
  "camping",
  "comida",
  "mirador",
  "descanso",
  "otro",
];

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

const LANDING_AUDIO_SRC = "/buena-ruta.mp3";

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

const btn2 = {
  ...btn,
  background: "#1e293b",
  color: "#94a3b8",
};

const dangerBtn = {
  ...btn,
  background: "#ef4444",
  color: "#fff",
};

// ── Helpers ─────────────────────────────────────────────────────────────────
const uid = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);

const normalizePoints = (pts) =>
  pts.map((p, i, arr) => ({
    ...p,
    label:
      i === 0
        ? "Inicio"
        : i === arr.length - 1 && arr.length > 1
          ? "Fin"
          : `Parada ${i}`,
  }));

const futureDate = () => {
  const d = new Date();
  d.setMonth(d.getMonth() + 3);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

const resetRouteDerived = (draft) => ({
  ...draft,
  segmentGeometries: [],
  segmentKm: [],
  totalKm: 0,
  provinces: [],
  computing: false,
  routeError: "",
});

const getRoadMeta = (value) =>
  ROAD_TYPES.find((r) => r.value === value) || ROAD_TYPES[0];

const isRouteType = (type) => type === "ruta" || type === "viaje";

const isNavigableRoute = (post) =>
  !!post && isRouteType(post.type) && Array.isArray(post.points) && post.points.length >= 2;

const haversineKm = (lat1, lng1, lat2, lng2) => {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

const getRemainingKm = (position, path) => {
  if (!position || !Array.isArray(path) || path.length === 0) return 0;
  let total = haversineKm(position.lat, position.lng, path[0][0], path[0][1]);
  for (let i = 0; i < path.length - 1; i++) {
    total += haversineKm(path[i][0], path[i][1], path[i + 1][0], path[i + 1][1]);
  }
  return Math.round(total * 10) / 10;
};

const flattenRoutePath = (post) => {
  if (post.segmentGeometries?.length) {
    const merged = [];
    post.segmentGeometries.forEach((seg, index) => {
      seg.forEach((point, pointIndex) => {
        if (index > 0 && pointIndex === 0) return;
        merged.push(point);
      });
    });
    return merged;
  }
  return (post.points || []).map((p) => [p.lat, p.lng]);
};

const getNavigatorLinks = (post) => {
  const destination = post.points[post.points.length - 1];
  const waypoints = post.points
    .slice(1, -1)
    .map((p) => `${p.lat},${p.lng}`)
    .join("|");

  const google = `https://www.google.com/maps/dir/?api=1&destination=${destination.lat},${destination.lng}${waypoints ? `&waypoints=${encodeURIComponent(waypoints)}` : ""}&travelmode=driving`;
  const waze = `https://waze.com/ul?ll=${destination.lat},${destination.lng}&navigate=yes`;
  const geo = `geo:${destination.lat},${destination.lng}?q=${destination.lat},${destination.lng}`;

  return { google, waze, geo };
};

const openExternalNavigator = (post, app) => {
  const links = getNavigatorLinks(post);
  const url = links[app] || links.google;
  window.open(url, "_blank", "noopener,noreferrer");
};

// ── Share link generator ─────────────────────────────────────────────────────
const generateShareLink = (post) => {
  try {
    const minimal = {
      t: post.title,
      d: post.desc || '',
      type: post.type,
      p: (post.points || []).map(p => [
        Math.round(p.lat * 100000) / 100000,
        Math.round(p.lng * 100000) / 100000
      ]),
      s: (post.segments || []).map(s => s.roadType),
      g: post.segmentGeometries || [],
      km: post.segmentKm || [],
      totalKm: post.totalKm || 0,
      prov: post.provinces || [],
      tags: post.tags || []
    };
    const encoded = btoa(JSON.stringify(minimal));
    return `${window.location.origin}/r/${encoded}`;
  } catch (e) {
    console.error('Error generating share link:', e);
    return null;
  }
};

const shareRoute = async (post) => {
  const url = generateShareLink(post);
  if (!url) return { success: false, method: 'error' };

  // Track share attempt
  try {
    const metrics = JSON.parse(localStorage.getItem('br_metrics') || '{}');
    metrics.shareAttempts = (metrics.shareAttempts || 0) + 1;
    localStorage.setItem('br_metrics', JSON.stringify(metrics));
  } catch {}

  // Try native share first (mobile)
  if (navigator.share) {
    try {
      await navigator.share({
        title: `🏍️ ${post.title} - BuenaRuta`,
        text: `Mirá esta ruta: ${post.title}${post.totalKm ? ` (${post.totalKm}km)` : ''}`,
        url
      });
      return { success: true, method: 'native' };
    } catch (e) {
      if (e.name === 'AbortError') return { success: false, method: 'cancelled' };
    }
  }

  // Fallback to clipboard
  try {
    await navigator.clipboard.writeText(url);
    return { success: true, method: 'clipboard', url };
  } catch {
    return { success: false, method: 'error', url };
  }
};

// ── Local storage ────────────────────────────────────────────────────────────
const LS = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {}
  },
};

const SEED_USERS = [
  {
    id: "u1",
    username: "motoviajero",
    email: "moto@example.com",
    pass: "1234",
    followers: ["u2"],
    following: ["u2"],
    moto: { modelo: "Honda CB 500", cilindrada: "500", anio: "2019" },
  },
  {
    id: "u2",
    username: "rutera_sur",
    email: "sur@example.com",
    pass: "1234",
    followers: ["u1"],
    following: ["u1"],
    moto: { modelo: "Yamaha Ténéré 700", cilindrada: "689", anio: "2022" },
  },
];

const SEED_POSTS = [
  {
    id: "p1",
    type: "ruta",
    userId: "u1",
    title: "Altas Cumbres por la variante vieja y Puentes Colgantes",
    desc: "La ruta cordobesa más mítica: subida por las Altas Cumbres, desvío al viejo camino de tierra entre Copina y El Cóndor, y cierre serrano rumbo a Mina Clavero.",
    tags: ["córdoba", "sierras", "puentes colgantes", "tierra", "curvas", "histórica"],
    points: normalizePoints([
      { lat: -31.447, lng: -64.430 },
      { lat: -31.529, lng: -64.731 },
      { lat: -31.649, lng: -64.997 },
      { lat: -31.693, lng: -65.018 },
      { lat: -31.721, lng: -65.003 },
      { lat: -31.728, lng: -65.006 },
      { lat: -31.721, lng: -65.000 },
      { lat: -31.719, lng: -65.002 },
      { lat: -31.725, lng: -65.003 },
      { lat: -31.721, lng: -65.004 },
      { lat: -31.719, lng: -65.004 },
      { lat: -31.720, lng: -65.033 },
      { lat: -31.721, lng: -65.138 }
    ]),
    segments: [
      { roadType: "asfalto" },
      { roadType: "asfalto" },
      { roadType: "tierra" },
      { roadType: "tierra" },
      { roadType: "tierra" },
      { roadType: "tierra" },
      { roadType: "tierra" },
      { roadType: "tierra" },
      { roadType: "tierra" },
      { roadType: "tierra" },
      { roadType: "asfalto" },
      { roadType: "asfalto" }
    ],
    segmentGeometries: [
      [[-31.447, -64.430], [-31.490, -64.560], [-31.529, -64.731]],
      [[-31.529, -64.731], [-31.590, -64.870], [-31.649, -64.997]],
      [[-31.649, -64.997], [-31.670, -65.006], [-31.693, -65.018]],
      [[-31.693, -65.018], [-31.707, -65.013], [-31.721, -65.003]],
      [[-31.721, -65.003], [-31.724, -65.004], [-31.728, -65.006]],
      [[-31.728, -65.006], [-31.725, -65.002], [-31.721, -65.000]],
      [[-31.721, -65.000], [-31.720, -65.001], [-31.719, -65.002]],
      [[-31.719, -65.002], [-31.722, -65.002], [-31.725, -65.003]],
      [[-31.725, -65.003], [-31.723, -65.004], [-31.721, -65.004]],
      [[-31.721, -65.004], [-31.720, -65.004], [-31.719, -65.004]],
      [[-31.719, -65.004], [-31.720, -65.016], [-31.720, -65.033]],
      [[-31.720, -65.033], [-31.721, -65.086], [-31.721, -65.138]]
    ],
    segmentKm: [19, 24, 6, 4, 2, 2, 1, 2, 1, 1, 8, 16],
    totalKm: 86,
    provinces: ["Córdoba"],
    likes: ["u2", "u1", "fan1", "fan2", "fan3", "fan4"],
    comments: [
      {
        id: "c1",
        userId: "u2",
        text: "Este desvío viejo cambia todo. Apenas entrás, ya sentís la ruta de otra forma.",
        createdAt: Date.now() - 3600000,
      },
    ],
    createdAt: Date.now() - 86400000,
  },
  {
    id: "p2",
    type: "ruta",
    userId: "u2",
    title: "Ruta de los Siete Lagos",
    desc: "El clásico patagónico entre Villa La Angostura y San Martín de los Andes: lagos, bosque andino y una de esas rutas que justifican todo el viaje.",
    tags: ["neuquén", "patagonia", "lagos", "ruta 40", "bosque"],
    points: normalizePoints([
      { lat: -40.762, lng: -71.646 },
      { lat: -40.814, lng: -71.644 },
      { lat: -40.923, lng: -71.627 },
      { lat: -40.976, lng: -71.593 },
      { lat: -40.996, lng: -71.576 },
      { lat: -40.160, lng: -71.353 }
    ]),
    segments: [
      { roadType: "asfalto" },
      { roadType: "asfalto" },
      { roadType: "asfalto" },
      { roadType: "asfalto" },
      { roadType: "asfalto" }
    ],
    segmentGeometries: [
      [[-40.762, -71.646], [-40.790, -71.645], [-40.814, -71.644]],
      [[-40.814, -71.644], [-40.865, -71.638], [-40.923, -71.627]],
      [[-40.923, -71.627], [-40.951, -71.612], [-40.976, -71.593]],
      [[-40.976, -71.593], [-40.987, -71.584], [-40.996, -71.576]],
      [[-40.996, -71.576], [-40.620, -71.520], [-40.160, -71.353]]
    ],
    segmentKm: [9, 16, 8, 4, 76],
    totalKm: 113,
    provinces: ["Neuquén"],
    likes: ["u1", "u2", "fan1", "fan2", "fan3", "fan4", "fan5", "fan6"],
    comments: [],
    createdAt: Date.now() - 86400000 * 2,
  },
  {
    id: "p3",
    type: "viaje",
    userId: "u1",
    title: "Quebrada de Humahuaca + Cuesta de Lipán hasta Salinas",
    desc: "Purmamarca, la subida brutal de la Cuesta de Lipán y las Salinas Grandes. Norte puro, altura, colores y sensación de viaje grande desde el primer kilómetro.",
    tags: ["jujuy", "quebrada", "altura", "salinas", "norte"],
    points: normalizePoints([
      { lat: -23.744, lng: -65.498 },
      { lat: -23.577, lng: -65.396 },
      { lat: -23.308, lng: -65.365 },
      { lat: -23.128, lng: -65.489 },
      { lat: -23.261, lng: -65.860 }
    ]),
    segments: [
      { roadType: "asfalto" },
      { roadType: "asfalto" },
      { roadType: "asfalto" },
      { roadType: "asfalto" }
    ],
    segmentGeometries: [
      [[-23.744, -65.498], [-23.660, -65.448], [-23.577, -65.396]],
      [[-23.577, -65.396], [-23.440, -65.378], [-23.308, -65.365]],
      [[-23.308, -65.365], [-23.210, -65.430], [-23.128, -65.489]],
      [[-23.128, -65.489], [-23.180, -65.650], [-23.261, -65.860]]
    ],
    segmentKm: [22, 30, 26, 50],
    totalKm: 128,
    provinces: ["Jujuy"],
    likes: ["u2", "fan1", "fan2", "fan3", "fan4"],
    comments: [],
    createdAt: Date.now() - 86400000 * 3,
  },
  {
    id: "p4",
    type: "viaje",
    userId: "u2",
    title: "Ruta 40 Patagonia: El Chaltén a Perito Moreno",
    desc: "Una postal enorme del sur: estepa, viento lateral, horizontes interminables y la sensación de estar metido de verdad en la Ruta 40.",
    tags: ["ruta 40", "santa cruz", "patagonia", "viento", "epica"],
    points: normalizePoints([
      { lat: -49.331, lng: -72.886 },
      { lat: -49.985, lng: -72.102 },
      { lat: -48.750, lng: -70.249 },
      { lat: -46.593, lng: -70.929 }
    ]),
    segments: [
      { roadType: "asfalto" },
      { roadType: "mixto" },
      { roadType: "asfalto" }
    ],
    segmentGeometries: [
      [[-49.331, -72.886], [-49.700, -72.500], [-49.985, -72.102]],
      [[-49.985, -72.102], [-49.380, -71.300], [-48.750, -70.249]],
      [[-48.750, -70.249], [-47.650, -70.500], [-46.593, -70.929]]
    ],
    segmentKm: [120, 210, 182],
    totalKm: 512,
    provinces: ["Santa Cruz"],
    likes: ["u1", "u2", "fan1", "fan2", "fan3", "fan4", "fan5"],
    comments: [],
    createdAt: Date.now() - 86400000 * 4,
  },
];

const getInitialUsers = () => LS.get("br_users", SEED_USERS);

// Migración: si hay posts guardados sin geometrías, usar las del SEED
const getInitialPosts = () => {
  const stored = LS.get("br_posts", null);
  if (!stored) return SEED_POSTS;
  
  // Migrar posts del SEED que no tengan geometrías
  const seedById = Object.fromEntries(SEED_POSTS.map(p => [p.id, p]));
  
  const migrated = stored.map(post => {
    // Si es un post del SEED y no tiene geometrías, copiarlas del SEED
    if (seedById[post.id] && (!post.segmentGeometries || post.segmentGeometries.length === 0)) {
      return {
        ...post,
        segmentGeometries: seedById[post.id].segmentGeometries,
        segmentKm: seedById[post.id].segmentKm,
        segments: seedById[post.id].segments,
        totalKm: seedById[post.id].totalKm,
        provinces: seedById[post.id].provinces,
      };
    }
    return post;
  });
  
  // Guardar migración
  LS.set("br_posts", migrated);
  return migrated;
};

const getInitialSession = () => LS.get("br_session", null);
const getInitialSavedRoutes = () => LS.get("br_saved_routes", []);

// ── APIs ─────────────────────────────────────────────────────────────────────
// ── Route geometry cache ─────────────────────────────────────────────────────
const routeCache = {
  get(p1, p2) {
    try {
      const key = `route:${p1.lat.toFixed(4)},${p1.lng.toFixed(4)}-${p2.lat.toFixed(4)},${p2.lng.toFixed(4)}`;
      const cached = localStorage.getItem(key);
      if (cached) {
        const data = JSON.parse(cached);
        // Cache válido por 7 días
        if (Date.now() - data.ts < 7 * 24 * 60 * 60 * 1000) {
          return data.value;
        }
        localStorage.removeItem(key);
      }
    } catch {}
    return null;
  },
  set(p1, p2, value) {
    try {
      const key = `route:${p1.lat.toFixed(4)},${p1.lng.toFixed(4)}-${p2.lat.toFixed(4)},${p2.lng.toFixed(4)}`;
      localStorage.setItem(key, JSON.stringify({ ts: Date.now(), value }));
    } catch {}
  }
};

const fetchSegmentRoute = async (p1, p2, signal) => {
  // Check cache first
  const cached = routeCache.get(p1, p2);
  if (cached) return cached;

  const url = `https://router.project-osrm.org/route/v1/driving/${p1.lng},${p1.lat};${p2.lng},${p2.lat}?overview=full&geometries=geojson`;
  
  // Create timeout if no signal provided
  const controller = signal ? null : new AbortController();
  const timeoutId = controller ? setTimeout(() => controller.abort(), 10000) : null;
  
  try {
    const r = await fetch(url, { 
      signal: signal || controller?.signal,
      headers: { 'Accept': 'application/json' }
    });
    
    if (timeoutId) clearTimeout(timeoutId);
    
    if (!r.ok) throw new Error("Error consultando el servicio de rutas");
    const data = await r.json();
    if (data.code !== "Ok") {
      throw new Error("OSRM no encontró ruta entre esos puntos");
    }
    
    const result = {
      geometry: data.routes[0].geometry.coordinates.map(([lng, lat]) => [lat, lng]),
      km: Math.round(data.routes[0].distance / 100) / 10,
    };
    
    // Save to cache
    routeCache.set(p1, p2, result);
    
    return result;
  } catch (e) {
    if (timeoutId) clearTimeout(timeoutId);
    if (e.name === 'AbortError') {
      throw new Error("Timeout: el servicio de rutas tardó demasiado");
    }
    throw e;
  }
};

const fetchProvince = async (point) => {
  try {
    const r = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${point.lat}&lon=${point.lng}&format=json&accept-language=es`
    );
    if (!r.ok) return null;
    const data = await r.json();
    return (
      data.address?.state ||
      data.address?.province ||
      data.address?.region ||
      null
    );
  } catch {
    return null;
  }
};

// ── Hooks ────────────────────────────────────────────────────────────────────
function useOnScreen(ref, rootMargin = "150px") {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!ref.current || visible) return;
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          obs.disconnect();
        }
      },
      { rootMargin }
    );
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

// ── UI small components ──────────────────────────────────────────────────────
function Avatar({ username, size = 32 }) {
  const initials = username ? username.slice(0, 2).toUpperCase() : "?";
  const hue = username ? (username.charCodeAt(0) * 7) % 360 : 200;

  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: `hsl(${hue},55%,32%)`,
        color: "#fff",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontWeight: 700,
        fontSize: size * 0.38,
        flexShrink: 0,
      }}
    >
      {initials}
    </div>
  );
}

function Badge({ tag, onRemove }) {
  return (
    <span
      style={{
        background: "#1e293b",
        color: "#94a3b8",
        borderRadius: 99,
        padding: "2px 10px",
        fontSize: 12,
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
      }}
    >
      #{tag}
      {onRemove && (
        <button
          onClick={onRemove}
          aria-label={`Quitar etiqueta ${tag}`}
          style={{
            background: "none",
            border: "none",
            color: "#64748b",
            cursor: "pointer",
            padding: 0,
            lineHeight: 1,
          }}
        >
          ×
        </button>
      )}
    </span>
  );
}

function RoadTypeBadge({ value }) {
  const rt = getRoadMeta(value);
  return (
    <span
      style={{
        background: rt.color + "22",
        color: rt.color,
        borderRadius: 99,
        padding: "2px 10px",
        fontSize: 12,
      }}
    >
      {rt.label}
    </span>
  );
}

function RouteSummary({ totalKm, provinces, segments, segmentKm }) {
  if (!totalKm && !provinces?.length) return null;

  const byType = {};
  (segments || []).forEach((s, i) => {
    const km = segmentKm?.[i] || 0;
    byType[s.roadType] = (byType[s.roadType] || 0) + km;
  });

  return (
    <div
      style={{
        background: "#0f172a",
        borderRadius: 10,
        padding: 12,
        marginTop: 10,
        marginBottom: 4,
      }}
    >
      <div
        style={{
          display: "flex",
          gap: 12,
          flexWrap: "wrap",
          alignItems: "center",
          marginBottom: Object.keys(byType).length ? 8 : 0,
        }}
      >
        {provinces?.length > 0 && (
          <span style={{ color: "#94a3b8", fontSize: 13 }}>
            📍 {provinces.join(" → ")}
          </span>
        )}
        {totalKm > 0 && (
          <span style={{ color: "#f59e0b", fontSize: 13, fontWeight: 700 }}>
            🛣️ {totalKm} km totales
          </span>
        )}
      </div>

      {Object.keys(byType).length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {Object.entries(byType).map(([type, km]) => {
            const rt = getRoadMeta(type);
            return (
              <span
                key={type}
                style={{
                  background: rt.color + "22",
                  color: rt.color,
                  borderRadius: 99,
                  padding: "2px 10px",
                  fontSize: 12,
                }}
              >
                {rt.label}: {Math.round(km)} km
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

function FeedFilters({
  filters,
  setFilters,
  allTags,
  allProvinces,
  title = "Filtrar publicaciones",
}) {
  return (
    <div
      style={{
        background: "#1e293b",
        borderRadius: 12,
        padding: 12,
        marginBottom: 14,
      }}
    >
      <p style={{ color: "#94a3b8", margin: "0 0 10px", fontSize: 13 }}>{title}</p>

      <input
        placeholder="🔍 Buscar por título o descripción..."
        style={{ ...inp, marginBottom: 10 }}
        value={filters.text}
        onChange={(e) =>
          setFilters((prev) => ({ ...prev, text: e.target.value }))
        }
      />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 8,
          marginBottom: 10,
        }}
      >
        <select
          style={inp}
          value={filters.type}
          onChange={(e) =>
            setFilters((prev) => ({ ...prev, type: e.target.value }))
          }
        >
          <option value="all">Todos los tipos</option>
          <option value="ruta">🛣️ Ruta</option>
          <option value="viaje">🧳 Viaje</option>
          <option value="lugar">📍 Lugar</option>
          <option value="evento">🎉 Evento</option>
        </select>

        <select
          style={inp}
          value={filters.province}
          onChange={(e) =>
            setFilters((prev) => ({ ...prev, province: e.target.value }))
          }
        >
          <option value="">Todas las provincias</option>
          {allProvinces.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr",
          gap: 8,
          marginBottom: 10,
        }}
      >
        <input
          type="number"
          min="0"
          placeholder="Likes mín."
          style={inp}
          value={filters.minLikes}
          onChange={(e) =>
            setFilters((prev) => ({ ...prev, minLikes: e.target.value }))
          }
        />
        <input
          type="number"
          min="0"
          placeholder="Km mín."
          style={inp}
          value={filters.minKm}
          onChange={(e) =>
            setFilters((prev) => ({ ...prev, minKm: e.target.value }))
          }
        />
        <input
          type="number"
          min="0"
          placeholder="Km máx."
          style={inp}
          value={filters.maxKm}
          onChange={(e) =>
            setFilters((prev) => ({ ...prev, maxKm: e.target.value }))
          }
        />
      </div>

      <select
        style={{ ...inp, marginBottom: 10 }}
        value={filters.sortBy}
        onChange={(e) =>
          setFilters((prev) => ({ ...prev, sortBy: e.target.value }))
        }
      >
        <option value="recent">Ordenar por: más recientes</option>
        <option value="likes">Ordenar por: más likes</option>
        <option value="km">Ordenar por: más km</option>
      </select>

      {allTags.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
          {allTags.map((t) => (
            <span
              key={t}
              onClick={() =>
                setFilters((prev) => ({
                  ...prev,
                  tag: prev.tag === t ? "" : t,
                }))
              }
              style={{
                background: filters.tag === t ? "#f59e0b22" : "#0f172a",
                color: filters.tag === t ? "#f59e0b" : "#64748b",
                borderRadius: 99,
                padding: "3px 10px",
                fontSize: 12,
                cursor: "pointer",
                border: `1px solid ${
                  filters.tag === t ? "#f59e0b" : "#334155"
                }`,
              }}
            >
              #{t}
            </span>
          ))}
        </div>
      )}

      <button
        onClick={() => setFilters(EMPTY_FILTERS)}
        style={{ ...btn2, width: "100%", padding: 10 }}
      >
        Limpiar filtros
      </button>
    </div>
  );
}

function HomeHero({
  post,
  currentUser,
  savedRoutes,
  onToggleSaved,
  onOpenNavigatorModal,
  onOpenPost,
  onExplore,
}) {
  if (!post) return null;
  const saved = currentUser
    ? savedRoutes.find((r) => r.userId === currentUser.id && r.postId === post.id)
    : null;

  return (
    <div
      style={{
        background: "linear-gradient(180deg, #1e293b 0%, #0f172a 100%)",
        borderRadius: 18,
        padding: 16,
        marginBottom: 16,
        border: "1px solid #334155",
        boxShadow: "0 10px 30px rgba(0,0,0,0.18)",
      }}
    >
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
        <span style={{ background: "#f59e0b22", color: "#f59e0b", borderRadius: 99, padding: "4px 10px", fontSize: 12, fontWeight: 700 }}>Ruta destacada</span>
        {post.provinces?.length > 0 && <span style={{ color: "#94a3b8", fontSize: 12 }}>📍 {post.provinces.join(" · ")}</span>}
        {post.totalKm > 0 && <span style={{ color: "#94a3b8", fontSize: 12 }}>🛣️ {post.totalKm} km</span>}
        <span style={{ color: "#94a3b8", fontSize: 12 }}>❤️ {post.likes?.length || 0}</span>
      </div>

      <h1 style={{ margin: "0 0 8px", color: "#f8fafc", fontSize: 28, lineHeight: 1.05 }}>
        Descubrí rutas reales para salir a rodar
      </h1>
      <p style={{ color: "#cbd5e1", margin: "0 0 14px", lineHeight: 1.5 }}>
        Guardalas, abrí la navegación y arrancá. BuenaRuta arranca fuerte con una joya cordobesa: {post.title}.
      </p>

      <div
        onClick={() => onOpenPost(post.id)}
        style={{ background: "#111827", borderRadius: 14, overflow: "hidden", cursor: "pointer", border: "1px solid #334155" }}
      >
        <div style={{ padding: 14 }}>
          <h3 style={{ margin: "0 0 6px", color: "#f8fafc", fontSize: 20 }}>{post.title}</h3>
          <p style={{ margin: 0, color: "#94a3b8", fontSize: 14, lineHeight: 1.45 }}>{post.desc}</p>
        </div>
        <MiniMap
          points={post.points}
          segmentGeometries={post.segmentGeometries}
          segmentTypes={post.segments?.map((s) => s.roadType)}
          eager={true}
        />
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 }}>
        <button onClick={() => onOpenPost(post.id)} style={{ ...btn, padding: "10px 14px" }}>Ver ruta destacada</button>
        {currentUser ? (
          <>
            <button onClick={() => onToggleSaved(post.id)} style={{ ...btn2, padding: "10px 14px" }}>
              {saved ? "⭐ Guardada" : "⭐ Guardar ruta"}
            </button>
            <button onClick={() => onOpenNavigatorModal(post.id)} style={{ ...btn2, padding: "10px 14px" }}>🚀 Hacer esta ruta</button>
          </>
        ) : (
          <button onClick={onExplore} style={{ ...btn2, padding: "10px 14px" }}>Explorar más rutas</button>
        )}
      </div>
    </div>
  );
}

function HomeQuickFilters({
  filters,
  setFilters,
  allProvinces,
  showAdvanced,
  setShowAdvanced,
  allTags,
  onExplore,
}) {
  return (
    <div style={{ background: "#1e293b", borderRadius: 14, padding: 12, marginBottom: 16, border: "1px solid #334155" }}>
      <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
        <input
          placeholder="Buscar una ruta por nombre..."
          style={{ ...inp, flex: 1 }}
          value={filters.text}
          onChange={(e) => setFilters((prev) => ({ ...prev, text: e.target.value }))}
        />
        <button onClick={onExplore} style={{ ...btn2, padding: "10px 12px", flexShrink: 0 }}>Explorar</button>
      </div>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
        {[
          { value: "recent", label: "Recientes" },
          { value: "likes", label: "Más likes" },
          { value: "km", label: "Más km" },
        ].map((opt) => (
          <button
            key={opt.value}
            onClick={() => setFilters((prev) => ({ ...prev, sortBy: opt.value }))}
            style={{
              ...btn2,
              padding: "6px 12px",
              borderRadius: 99,
              background: filters.sortBy === opt.value ? "#f59e0b" : "#0f172a",
              color: filters.sortBy === opt.value ? "#0f172a" : "#94a3b8",
            }}
          >
            {opt.label}
          </button>
        ))}
      </div>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <button
          onClick={() => setFilters((prev) => ({ ...prev, province: "" }))}
          style={{
            ...btn2,
            padding: "6px 12px",
            borderRadius: 99,
            background: !filters.province ? "#f59e0b22" : "#0f172a",
            color: !filters.province ? "#f59e0b" : "#94a3b8",
          }}
        >
          Todas
        </button>
        {allProvinces.map((p) => (
          <button
            key={p}
            onClick={() => setFilters((prev) => ({ ...prev, province: prev.province === p ? "" : p }))}
            style={{
              ...btn2,
              padding: "6px 12px",
              borderRadius: 99,
              background: filters.province === p ? "#f59e0b22" : "#0f172a",
              color: filters.province === p ? "#f59e0b" : "#94a3b8",
            }}
          >
            {p}
          </button>
        ))}
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10 }}>
        <button onClick={() => setShowAdvanced((v) => !v)} style={{ ...btn2, padding: "8px 12px" }}>
          {showAdvanced ? "Ocultar filtros" : "Más filtros"}
        </button>
        <button onClick={() => setFilters(EMPTY_FILTERS)} style={{ ...btn2, padding: "8px 12px" }}>Limpiar</button>
      </div>

      {showAdvanced && (
        <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <select
              style={inp}
              value={filters.type}
              onChange={(e) => setFilters((prev) => ({ ...prev, type: e.target.value }))}
            >
              <option value="all">Todos los tipos</option>
              <option value="ruta">Ruta</option>
              <option value="viaje">Viaje</option>
              <option value="lugar">Lugar</option>
              <option value="evento">Evento</option>
            </select>
            <input
              type="number"
              min="0"
              placeholder="Likes mín."
              style={inp}
              value={filters.minLikes}
              onChange={(e) => setFilters((prev) => ({ ...prev, minLikes: e.target.value }))}
            />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <input
              type="number"
              min="0"
              placeholder="Km mín."
              style={inp}
              value={filters.minKm}
              onChange={(e) => setFilters((prev) => ({ ...prev, minKm: e.target.value }))}
            />
            <input
              type="number"
              min="0"
              placeholder="Km máx."
              style={inp}
              value={filters.maxKm}
              onChange={(e) => setFilters((prev) => ({ ...prev, maxKm: e.target.value }))}
            />
          </div>
          {allTags.length > 0 && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {allTags.map((t) => (
                <span
                  key={t}
                  onClick={() => setFilters((prev) => ({ ...prev, tag: prev.tag === t ? "" : t }))}
                  style={{
                    background: filters.tag === t ? "#f59e0b22" : "#0f172a",
                    color: filters.tag === t ? "#f59e0b" : "#64748b",
                    borderRadius: 99,
                    padding: "3px 10px",
                    fontSize: 12,
                    cursor: "pointer",
                    border: `1px solid ${filters.tag === t ? "#f59e0b" : "#334155"}`,
                  }}
                >
                  #{t}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CompactRouteCard({
  post,
  currentUser,
  savedRoutes,
  onToggleSaved,
  onOpenNavigatorModal,
  onOpenPost,
}) {
  const saved = currentUser
    ? savedRoutes.find((r) => r.userId === currentUser.id && r.postId === post.id)
    : null;

  return (
    <div style={{ background: "#1e293b", borderRadius: 14, padding: 14, border: "1px solid #334155" }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
        {post.provinces?.length > 0 && <span style={{ color: "#94a3b8", fontSize: 12 }}>📍 {post.provinces.join(" · ")}</span>}
        {post.totalKm > 0 && <span style={{ color: "#f59e0b", fontSize: 12, fontWeight: 700 }}>🛣️ {post.totalKm} km</span>}
        <span style={{ color: "#64748b", fontSize: 12 }}>❤️ {post.likes?.length || 0}</span>
      </div>
      <h4 style={{ margin: "0 0 6px", color: "#f8fafc", fontSize: 18 }}>{post.title}</h4>
      <p style={{ margin: 0, color: "#94a3b8", fontSize: 14, lineHeight: 1.45 }}>{post.desc}</p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 10 }}>
        {(post.tags || []).slice(0, 4).map((t) => <Badge key={t} tag={t} />)}
      </div>
      {isNavigableRoute(post) && (
        <div style={{ marginTop: 12, borderRadius: 12, overflow: "hidden", border: "1px solid #334155" }}>
          <MiniMap
            points={post.points}
            segmentGeometries={post.segmentGeometries}
            segmentTypes={post.segments?.map((s) => s.roadType)}
          />
        </div>
      )}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
        <button onClick={() => onOpenPost(post.id)} style={{ ...btn, padding: "9px 12px" }}>Ver detalle</button>
        {currentUser && (
          <>
            <button onClick={() => onToggleSaved(post.id)} style={{ ...btn2, padding: "9px 12px" }}>
              {saved ? "⭐ Guardada" : "⭐ Guardar"}
            </button>
            {isNavigableRoute(post) && (
              <button onClick={() => onOpenNavigatorModal(post.id)} style={{ ...btn2, padding: "9px 12px" }}>🚀 Hacer ruta</button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function HomeSection({ title, subtitle, posts, currentUser, savedRoutes, onToggleSaved, onOpenNavigatorModal, onOpenPost }) {
  if (!posts.length) return null;
  return (
    <section style={{ marginBottom: 18 }}>
      <div style={{ marginBottom: 10 }}>
        <h3 style={{ margin: 0, color: "#f8fafc", fontSize: 18 }}>{title}</h3>
        {subtitle && <p style={{ margin: "4px 0 0", color: "#64748b", fontSize: 13 }}>{subtitle}</p>}
      </div>
      <div style={{ display: "grid", gap: 10 }}>
        {posts.map((post) => (
          <CompactRouteCard
            key={post.id}
            post={post}
            currentUser={currentUser}
            savedRoutes={savedRoutes}
            onToggleSaved={onToggleSaved}
            onOpenNavigatorModal={onOpenNavigatorModal}
            onOpenPost={onOpenPost}
          />
        ))}
      </div>
    </section>
  );
}

function SavedRoutesPanel({
  currentUser,
  savedRoutes,
  posts,
  users,
  onOpenPost,
  onStartNavigation,
  onToggleSaved,
  onMarkCompleted,
}) {
  const mine = savedRoutes
    .filter((r) => r.userId === currentUser?.id)
    .sort((a, b) => b.savedAt - a.savedAt);

  if (!currentUser) return null;

  return (
    <div
      style={{
        background: "#1e293b",
        borderRadius: 12,
        padding: 12,
        marginBottom: 14,
      }}
    >
      <h3 style={{ margin: "0 0 10px", color: "#f1f5f9", fontSize: 16 }}>
        ⭐ Mis rutas guardadas
      </h3>

      {mine.length === 0 && (
        <p style={{ color: "#64748b", margin: 0, fontSize: 13 }}>
          Todavía no guardaste rutas. Abrí una ruta y tocá “Guardar ruta”.
        </p>
      )}

      {mine.map((saved) => {
        const post = posts.find((p) => p.id === saved.postId);
        if (!post) return null;
        const author = users.find((u) => u.id === post.userId);
        return (
          <div
            key={saved.id}
            style={{
              background: "#0f172a",
              borderRadius: 10,
              padding: 10,
              marginBottom: 8,
              border: "1px solid #334155",
            }}
          >
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
              <Avatar username={author?.username} size={28} />
              <div style={{ flex: 1 }}>
                <div
                  onClick={() => onOpenPost(post.id)}
                  style={{ color: "#f1f5f9", fontWeight: 700, cursor: "pointer" }}
                >
                  {post.title}
                </div>
                <div style={{ color: "#64748b", fontSize: 12 }}>
                  @{author?.username} · {post.totalKm || 0} km · {saved.status === "completed" ? "completada" : saved.status === "active" ? "en curso" : "guardada"}
                </div>
              </div>
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                onClick={() => onStartNavigation(saved.id, post.id)}
                disabled={!isNavigableRoute(post)}
                style={{
                  ...btn,
                  padding: "8px 12px",
                  opacity: isNavigableRoute(post) ? 1 : 0.5,
                }}
              >
                🚀 Navegar
              </button>
              <button onClick={() => onOpenPost(post.id)} style={{ ...btn2, padding: "8px 12px" }}>
                Ver detalle
              </button>
              <button onClick={() => onToggleSaved(post.id)} style={{ ...btn2, padding: "8px 12px" }}>
                Quitar
              </button>
              {saved.status !== "completed" && (
                <button onClick={() => onMarkCompleted(saved.id)} style={{ ...btn2, padding: "8px 12px" }}>
                  ✅ Marcar hecha
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function RouteActions({
  post,
  currentUser,
  savedRoutes,
  onToggleSaved,
  onOpenNavigatorModal,
}) {
  if (!currentUser || !isNavigableRoute(post)) return null;

  const saved = savedRoutes.find(
    (r) => r.userId === currentUser.id && r.postId === post.id
  );

  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 16 }}>
      <button onClick={() => onToggleSaved(post.id)} style={{ ...btn, padding: "10px 14px" }}>
        {saved ? "⭐ Guardada" : "⭐ Guardar ruta"}
      </button>
      <button onClick={() => onOpenNavigatorModal(post.id)} style={{ ...btn2, padding: "10px 14px" }}>
        🚀 Hacer esta ruta
      </button>
    </div>
  );
}

function NavigatorChooserModal({ post, onClose, onChooseApp, onStartInternal }) {
  if (!post) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(2,6,23,0.7)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
        zIndex: 2000,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 420,
          background: "#1e293b",
          borderRadius: 16,
          padding: 16,
          border: "1px solid #334155",
        }}
      >
        <h3 style={{ margin: "0 0 8px", color: "#f8fafc" }}>🚀 Hacer esta ruta</h3>
        <p style={{ color: "#94a3b8", margin: "0 0 14px", fontSize: 14 }}>
          Elegí si querés abrir la ruta en otra app o usar el modo navegación simple dentro de BuenaRuta.
        </p>

        <div style={{ display: "grid", gap: 8 }}>
          <button onClick={() => onChooseApp("google")} style={{ ...btn, padding: 12 }}>
            Abrir en Google Maps
          </button>
          <button onClick={() => onChooseApp("waze")} style={{ ...btn2, padding: 12 }}>
            Abrir en Waze
          </button>
          <button onClick={() => onChooseApp("geo")} style={{ ...btn2, padding: 12 }}>
            Abrir en app del teléfono
          </button>
          <button onClick={onStartInternal} style={{ ...btn2, padding: 12 }}>
            🧭 Navegación simple en BuenaRuta
          </button>
        </div>

        <button onClick={onClose} style={{ ...btn2, width: "100%", padding: 10, marginTop: 12 }}>
          Cancelar
        </button>
      </div>
    </div>
  );
}

function NavigationMap({ position, post, remainingPath }) {
  const ref = useRef(null);
  const mapRef = useRef(null);
  const layersRef = useRef([]);

  useEffect(() => {
    let cancelled = false;
    loadLeaflet()
      .then((L) => {
        if (cancelled || !ref.current || mapRef.current) return;
        const center = position
          ? [position.lat, position.lng]
          : post?.points?.length
            ? [post.points[0].lat, post.points[0].lng]
            : [-31.4, -64.18];
        const map = L.map(ref.current, { zoomControl: true }).setView(center, 11);
        mapRef.current = map;
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          attribution: '© <a href="https://openstreetmap.org">OSM</a>',
          maxZoom: 19,
        }).addTo(map);
      })
      .catch(console.error);

    return () => {
      cancelled = true;
    };
  }, [post, position]);

  useEffect(() => {
    if (!mapRef.current || !window.L || !post) return;
    const L = window.L;

    layersRef.current.forEach((l) => l.remove?.());
    layersRef.current = [];

    const fullPath = flattenRoutePath(post);
    if (fullPath.length > 1) {
      layersRef.current.push(
        L.polyline(fullPath, { color: "#475569", weight: 4, opacity: 0.5 }).addTo(mapRef.current)
      );
    }

    if (remainingPath?.length > 1) {
      layersRef.current.push(
        L.polyline(remainingPath, { color: "#f59e0b", weight: 5, opacity: 0.95 }).addTo(mapRef.current)
      );
    }

    post.points.forEach((p, i) => {
      const color = i === 0 ? "#22c55e" : i === post.points.length - 1 ? "#ef4444" : "#f59e0b";
      const icon = L.divIcon({
        html: `<div style="background:${color};width:14px;height:14px;border-radius:50%;border:2px solid #fff;box-shadow:0 1px 5px #0009"></div>`,
        iconSize: [14, 14],
        iconAnchor: [7, 7],
        className: "",
      });
      layersRef.current.push(
        L.marker([p.lat, p.lng], { icon }).bindTooltip(p.label, { permanent: false }).addTo(mapRef.current)
      );
    });

    if (position) {
      layersRef.current.push(
        L.circleMarker([position.lat, position.lng], {
          radius: 9,
          color: "#fff",
          weight: 2,
          fillColor: "#38bdf8",
          fillOpacity: 1,
        }).addTo(mapRef.current)
      );
      mapRef.current.setView([position.lat, position.lng], 13);
    } else if (post.points?.length > 1) {
      mapRef.current.fitBounds(L.latLngBounds(post.points.map((p) => [p.lat, p.lng])), {
        padding: [30, 30],
      });
    }
  }, [position, post, remainingPath]);

  useEffect(() => {
    return () => {
      layersRef.current.forEach((l) => l.remove?.());
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  return <div ref={ref} style={{ width: "100%", height: "100%", background: "#0f172a" }} />;
}

function ActiveNavigation({ post, onClose, onComplete }) {
  const [position, setPosition] = useState(null);
  const [geoErr, setGeoErr] = useState("");
  const [checkpointIndex, setCheckpointIndex] = useState(0);
  const [watchSupported] = useState(() => typeof navigator !== "undefined" && !!navigator.geolocation);

  const path = useMemo(() => flattenRoutePath(post), [post]);
  const nextPoint = post.points[Math.min(checkpointIndex + 1, post.points.length - 1)];
  const distanceToNext = position && nextPoint
    ? haversineKm(position.lat, position.lng, nextPoint.lat, nextPoint.lng)
    : null;
  const remainingPath = useMemo(() => {
    if (!position) return path;
    return [[position.lat, position.lng], ...path];
  }, [position, path]);
  const remainingKm = useMemo(() => getRemainingKm(position, path), [position, path]);

  useEffect(() => {
    if (!watchSupported) {
      setGeoErr("Geolocalización no disponible en este dispositivo.");
      return;
    }

    let watchId = null;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setPosition({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          speed: pos.coords.speed,
        });
      },
      () => {
        setGeoErr("No pude obtener tu ubicación actual.");
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );

    watchId = navigator.geolocation.watchPosition(
      (pos) => {
        setGeoErr("");
        setPosition({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          speed: pos.coords.speed,
        });
      },
      () => {
        setGeoErr("No pude seguir tu ubicación en tiempo real.");
      },
      {
        enableHighAccuracy: true,
        maximumAge: 3000,
        timeout: 10000,
      }
    );

    return () => {
      if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    };
  }, [watchSupported]);

  useEffect(() => {
    if (!distanceToNext || distanceToNext > 0.2) return;
    if (checkpointIndex < post.points.length - 1) {
      setCheckpointIndex((prev) => Math.min(prev + 1, post.points.length - 1));
    }
  }, [distanceToNext, checkpointIndex, post.points.length]);

  const finish = () => {
    onComplete();
    onClose();
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 3000,
        background: "#020617",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div style={{ padding: 12, background: "#0f172a", borderBottom: "1px solid #334155" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button onClick={onClose} style={{ ...btn2, padding: "8px 12px" }}>
            ✕ Salir
          </button>
          <div style={{ flex: 1 }}>
            <div style={{ color: "#f8fafc", fontWeight: 700 }}>{post.title}</div>
            <div style={{ color: "#94a3b8", fontSize: 12 }}>
              Próximo punto: {nextPoint?.label || "Destino"}
            </div>
          </div>
          <button onClick={finish} style={{ ...btn, padding: "8px 12px" }}>
            ✅ Terminar
          </button>
        </div>
      </div>

      <div style={{ flex: 1, position: "relative" }}>
        <NavigationMap position={position} post={post} remainingPath={remainingPath} />

        <div
          style={{
            position: "absolute",
            left: 12,
            right: 12,
            bottom: 12,
            background: "rgba(15, 23, 42, 0.94)",
            border: "1px solid #334155",
            borderRadius: 16,
            padding: 16,
          }}
        >
          <div style={{ display: "flex", gap: 16, alignItems: "center", marginBottom: 12 }}>
            <div style={{ fontSize: 44 }}>🧭</div>
            <div style={{ flex: 1 }}>
              <div style={{ color: "#f59e0b", fontWeight: 800, fontSize: 28 }}>
                {distanceToNext !== null ? `${distanceToNext.toFixed(1)} km` : "—"}
              </div>
              <div style={{ color: "#cbd5e1", fontSize: 15 }}>
                hasta {nextPoint?.label || "el destino"}
              </div>
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{ color: "#f8fafc", fontSize: 24, fontWeight: 800 }}>
                {position?.speed ? Math.round(position.speed * 3.6) : 0}
              </div>
              <div style={{ color: "#64748b", fontSize: 12 }}>km/h</div>
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
            <span style={{ color: "#94a3b8", fontSize: 13 }}>🛣️ Restan {remainingKm} km</span>
            <span style={{ color: "#94a3b8", fontSize: 13 }}>
              ✅ Checkpoint {Math.min(checkpointIndex, post.points.length - 1) + 1}/{post.points.length}
            </span>
          </div>

          {geoErr && <p style={{ color: "#ef4444", fontSize: 13, margin: "6px 0 10px" }}>{geoErr}</p>}

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              onClick={() => setCheckpointIndex((prev) => Math.min(prev + 1, post.points.length - 1))}
              style={{ ...btn2, padding: "10px 12px" }}
            >
              ✅ Llegué al punto
            </button>
            <button onClick={finish} style={{ ...btn, padding: "10px 12px" }}>
              Marcar ruta hecha
            </button>
            <button onClick={onClose} style={{ ...dangerBtn, padding: "10px 12px" }}>
              Abandonar navegación
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Map shared renderer ──────────────────────────────────────────────────────
const renderMapLayers = (
  L,
  map,
  points,
  segmentGeometries,
  segmentTypes,
  layersRef,
  readonly,
  onChange,
  ptRef,
  onDeletePoint
) => {
  layersRef.current.forEach((l) => l.remove());
  layersRef.current = [];

  points.forEach((p, i) => {
    const color =
      i === 0
        ? "#22c55e"
        : i === points.length - 1 && points.length > 1
          ? "#ef4444"
          : "#f59e0b";

    const size = readonly ? 10 : 14;
    const icon = L.divIcon({
      html: `<div style="background:${color};width:${size}px;height:${size}px;border-radius:50%;border:2px solid #fff;box-shadow:0 1px 5px #0009"></div>`,
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
      className: "",
    });

    const m = L.marker([p.lat, p.lng], {
      icon,
      draggable: !readonly,
      keyboard: true,
    })
      .bindTooltip(p.label, {
        permanent: true,
        direction: "top",
        offset: [0, -10],
      })
      .addTo(map);

    if (!readonly && onChange && ptRef) {
      m.on("dragend", (e) => {
        const { lat, lng } = e.target.getLatLng();
        onChange(
          normalizePoints(
            ptRef.current.map((x, j) => (j === i ? { ...x, lat, lng } : x))
          )
        );
      });

      m.on("contextmenu", () => {
        const removed = ptRef.current[i];
        const next = normalizePoints(ptRef.current.filter((_, j) => j !== i));
        onChange(next);
        onDeletePoint?.({ point: removed, index: i });
      });
    }

    layersRef.current.push(m);
  });

  if (segmentGeometries?.length > 0) {
    segmentGeometries.forEach((geo, i) => {
      if (!geo || geo.length < 2) return;
      const type = segmentTypes?.[i] || "asfalto";
      const rt = getRoadMeta(type);
      layersRef.current.push(
        L.polyline(geo, {
          color: rt.color,
          weight: 4,
          opacity: 0.9,
        }).addTo(map)
      );
    });
  } else if (points.length > 1) {
    layersRef.current.push(
      L.polyline(
        points.map((p) => [p.lat, p.lng]),
        {
          color: "#64748b",
          weight: 3,
          opacity: 0.5,
          dashArray: "8,6",
        }
      ).addTo(map)
    );
  }

  if (points.length > 1) {
    map.fitBounds(
      L.latLngBounds(points.map((p) => [p.lat, p.lng])),
      { padding: [30, 30] }
    );
  } else if (points.length === 1) {
    map.setView([points[0].lat, points[0].lng], 12);
  }
};

// ── MiniMap ──────────────────────────────────────────────────────────────────
function MiniMap({ points, segmentGeometries, segmentTypes, eager = false }) {
  const wrapperRef = useRef(null);
  const lazyVisible = useOnScreen(wrapperRef);
  // Si eager=true, visible inmediato (para el hero). Si no, lazy loading.
  const visible = eager || lazyVisible;
  const ref = useRef(null);
  const mapRef = useRef(null);
  const layersRef = useRef([]);

  useEffect(() => {
    if (!visible) return;

    let cancelled = false;

    loadLeaflet()
      .then((L) => {
        if (cancelled || !ref.current || mapRef.current) return;

        const center = points.length
          ? [points[0].lat, points[0].lng]
          : [-31.4, -64.18];

        const map = L.map(ref.current, {
          zoomControl: false,
          dragging: false,
          scrollWheelZoom: false,
          doubleClickZoom: false,
          touchZoom: false,
          boxZoom: false,
          keyboard: false,
        }).setView(center, 9);

        mapRef.current = map;

        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          attribution: "",
          maxZoom: 19,
        }).addTo(map);
      })
      .catch(console.error);

    return () => {
      cancelled = true;
    };
  }, [visible, points]);

  useEffect(() => {
    if (!visible || !mapRef.current || !window.L) return;

    renderMapLayers(
      window.L,
      mapRef.current,
      points,
      segmentGeometries,
      segmentTypes,
      layersRef,
      true,
      null,
      null,
      null
    );
  }, [visible, points, segmentGeometries, segmentTypes]);

  useEffect(() => {
    return () => {
      layersRef.current.forEach((l) => l.remove?.());
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  return (
    <div ref={wrapperRef}>
      <div
        ref={ref}
        style={{
          width: "100%",
          height: 160,
          borderRadius: "0 0 10px 10px",
          overflow: "hidden",
          marginTop: 10,
          border: "1px solid #334155",
          background: "#0f172a",
        }}
      />
    </div>
  );
}

// ── MapPicker ────────────────────────────────────────────────────────────────
function MapPicker({
  points,
  onChange,
  readonly = false,
  segmentGeometries = [],
  segmentTypes = [],
  onDeletePoint,
}) {
  const ref = useRef(null);
  const mapRef = useRef(null);
  const layersRef = useRef([]);
  const ptRef = useRef(points);
  ptRef.current = points;

  useEffect(() => {
    let cancelled = false;

    loadLeaflet()
      .then((L) => {
        if (cancelled || !ref.current || mapRef.current) return;

        const center = points.length
          ? [points[0].lat, points[0].lng]
          : [-31.4, -64.18];

        const map = L.map(ref.current).setView(center, 9);
        mapRef.current = map;

        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          attribution: '© <a href="https://openstreetmap.org">OSM</a>',
          maxZoom: 19,
        }).addTo(map);

        if (!readonly) {
          map.on("click", (e) => {
            const updated = normalizePoints([
              ...ptRef.current,
              { lat: e.latlng.lat, lng: e.latlng.lng },
            ]);
            onChange(updated);
          });
        }
      })
      .catch(console.error);

    return () => {
      cancelled = true;
    };
  }, [readonly, onChange, points]);

  useEffect(() => {
    if (!mapRef.current || !window.L) return;

    renderMapLayers(
      window.L,
      mapRef.current,
      points,
      segmentGeometries,
      segmentTypes,
      layersRef,
      readonly,
      onChange,
      ptRef,
      onDeletePoint
    );
  }, [points, segmentGeometries, segmentTypes, readonly, onChange, onDeletePoint]);

  useEffect(() => {
    return () => {
      layersRef.current.forEach((l) => l.remove?.());
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  return (
    <div
      ref={ref}
      style={{
        width: "100%",
        height: 320,
        borderRadius: 10,
        overflow: "hidden",
        border: "1px solid #1e293b",
        background: "#0f172a",
      }}
    />
  );
}

// ── LocationSearch ───────────────────────────────────────────────────────────
function LocationSearch({ onSelect }) {
  const [q, setQ] = useState("");
  const [res, setRes] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const abortRef = useRef(null);
  const reqIdRef = useRef(0);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const search = async () => {
    if (!q.trim()) return;

    if (abortRef.current) abortRef.current.abort();
    abortRef.current = new AbortController();
    const reqId = ++reqIdRef.current;

    setLoading(true);
    setErr("");
    setRes([]);

    try {
      const r = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(
          q
        )}&format=json&limit=5&accept-language=es`,
        {
          signal: abortRef.current.signal,
          headers: { "Accept-Language": "es" },
        }
      );

      if (!r.ok) throw new Error("Error al buscar");

      const data = await r.json();
      if (reqId !== reqIdRef.current) return;

      setRes(data);
      if (!data.length) setErr("Sin resultados.");
    } catch (e) {
      if (e.name !== "AbortError" && reqId === reqIdRef.current) {
        setErr("Error de red.");
      }
    } finally {
      if (reqId === reqIdRef.current) setLoading(false);
    }
  };

  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: "flex", gap: 6 }}>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && search()}
          placeholder="Buscar ciudad o lugar..."
          style={inp}
          aria-label="Buscar ciudad o lugar"
        />
        <button
          onClick={search}
          style={{ ...btn, padding: "8px 14px", flexShrink: 0 }}
          aria-label="Buscar ubicación"
        >
          {loading ? "…" : "🔍"}
        </button>
      </div>

      {err && (
        <p style={{ color: "#ef4444", fontSize: 12, margin: "4px 0 0" }}>
          {err}
        </p>
      )}

      {res.length > 0 && (
        <div
          style={{
            background: "#1e293b",
            borderRadius: 8,
            marginTop: 4,
            overflow: "hidden",
            maxHeight: 190,
            overflowY: "auto",
          }}
        >
          {res.map((r, index) => (
            <div
              key={`${r.place_id}-${index}`}
              onClick={() => {
                onSelect(parseFloat(r.lat), parseFloat(r.lon), r.display_name);
                setRes([]);
                setQ("");
              }}
              style={{
                padding: "9px 12px",
                cursor: "pointer",
                fontSize: 13,
                color: "#cbd5e1",
                borderBottom: "1px solid #0f172a",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "#0f172a";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "transparent";
              }}
            >
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
      <p style={{ color: "#64748b", fontSize: 13, marginBottom: 8 }}>
        🛣️ Tipo de camino por tramo
      </p>

      {points.slice(0, -1).map((p, i) => (
        <div
          key={i}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 6,
            background: "#1e293b",
            borderRadius: 8,
            padding: "8px 10px",
          }}
        >
          <span style={{ color: "#94a3b8", fontSize: 12, flex: 1 }}>
            {p.label} → {points[i + 1].label}
          </span>

          <select
            value={segments[i]?.roadType || "asfalto"}
            onChange={(e) => {
              const next = [...segments];
              next[i] = { ...next[i], roadType: e.target.value };
              onChange(next);
            }}
            style={{
              background: "#0f172a",
              border: "1px solid #334155",
              borderRadius: 6,
              color: "#f1f5f9",
              padding: "4px 8px",
              fontSize: 13,
            }}
            aria-label={`Tipo de camino del tramo ${i + 1}`}
          >
            {ROAD_TYPES.map((rt) => (
              <option key={rt.value} value={rt.value}>
                {rt.label}
              </option>
            ))}
          </select>
        </div>
      ))}
    </div>
  );
}

// ── PostCard ─────────────────────────────────────────────────────────────────
function PostCard({
  post,
  cu,
  users,
  onLike,
  onComment,
  goProfile,
  goPostId,
  savedRoutes,
  onToggleSaved,
  onOpenNavigatorModal,
}) {
  const author = users.find((u) => u.id === post.userId);
  const meta = TYPE_META[post.type];
  const liked = !!(cu && post.likes.includes(cu.id));
  const [showC, setShowC] = useState(false);
  const [cText, setCText] = useState("");
  const [shareStatus, setShareStatus] = useState(null);
  const routePost = isRouteType(post.type);
  const hasMap = routePost && post.points?.length > 0;
  const saved = cu
    ? savedRoutes.find((r) => r.userId === cu.id && r.postId === post.id)
    : null;

  const submitComment = () => {
    if (!cText.trim()) return;
    onComment(post.id, cText.trim());
    setCText("");
  };

  const handleShare = async () => {
    setShareStatus('sharing');
    const result = await shareRoute(post);
    if (result.success) {
      setShareStatus(result.method === 'clipboard' ? 'copied' : 'shared');
      setTimeout(() => setShareStatus(null), 2500);
    } else if (result.method !== 'cancelled') {
      setShareStatus('error');
      setTimeout(() => setShareStatus(null), 2500);
    } else {
      setShareStatus(null);
    }
  };

  return (
    <div
      style={{
        background: "#1e293b",
        borderRadius: 14,
        marginBottom: 12,
        overflow: "hidden",
      }}
    >
      <div style={{ padding: 16 }}>
        <div
          style={{
            display: "flex",
            gap: 10,
            alignItems: "center",
            marginBottom: 10,
          }}
        >
          <div onClick={() => goProfile(author?.id)} style={{ cursor: "pointer" }}>
            <Avatar username={author?.username} />
          </div>

          <div style={{ flex: 1 }}>
            <span
              style={{ color: "#f8fafc", fontWeight: 600, cursor: "pointer" }}
              onClick={() => goProfile(author?.id)}
            >
              @{author?.username}
            </span>

            {author?.moto && (
              <span style={{ color: "#475569", fontSize: 11, marginLeft: 8 }}>
                🏍️ {author.moto.modelo}
              </span>
            )}

            <div
              style={{
                display: "flex",
                gap: 6,
                alignItems: "center",
                marginTop: 2,
                flexWrap: "wrap",
              }}
            >
              <span
                style={{
                  background: meta.color + "22",
                  color: meta.color,
                  borderRadius: 99,
                  padding: "1px 8px",
                  fontSize: 12,
                }}
              >
                {meta.icon} {meta.label}
              </span>

              {post.totalKm > 0 && (
                <span style={{ color: "#f59e0b", fontSize: 12, fontWeight: 700 }}>
                  🛣️ {post.totalKm} km
                </span>
              )}

              {post.likes?.length > 0 && (
                <span style={{ color: "#64748b", fontSize: 12 }}>
                  ❤️ {post.likes.length}
                </span>
              )}

              {saved && (
                <span style={{ color: "#f59e0b", fontSize: 12 }}>⭐ Guardada</span>
              )}

              {post.eventDate && (
                <span style={{ color: "#64748b", fontSize: 12 }}>
                  📅 {post.eventDate}
                </span>
              )}

              {post.placeType && (
                <span style={{ color: "#64748b", fontSize: 12 }}>
                  🏷 {post.placeType}
                </span>
              )}
            </div>
          </div>
        </div>

        <h3
          onClick={() => goPostId(post.id)}
          style={{
            color: "#f1f5f9",
            margin: "0 0 4px",
            fontSize: 16,
            cursor: "pointer",
          }}
        >
          {post.title}
        </h3>

        <p
          style={{
            color: "#94a3b8",
            fontSize: 14,
            margin: "0 0 8px",
            lineHeight: 1.5,
          }}
        >
          {post.desc}
        </p>

        {post.provinces?.length > 0 && (
          <p style={{ color: "#64748b", fontSize: 12, margin: "0 0 8px" }}>
            📍 {post.provinces.join(" → ")}
          </p>
        )}

        {post.segments?.length > 0 && (
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 8 }}>
            {[...new Set(post.segments.map((s) => s.roadType))].map((rt) => (
              <RoadTypeBadge key={rt} value={rt} />
            ))}
          </div>
        )}

        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 10 }}>
          {post.tags.map((t) => (
            <Badge key={t} tag={t} />
          ))}
        </div>

        <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
          <button
            onClick={() => cu && onLike(post.id)}
            aria-label={liked ? "Quitar me gusta" : "Dar me gusta"}
            style={{
              background: "none",
              border: "none",
              color: liked ? "#ef4444" : "#64748b",
              cursor: "pointer",
              fontSize: 15,
              padding: 0,
            }}
          >
            {liked ? "❤️" : "🤍"} {post.likes.length}
          </button>

          <button
            onClick={() => setShowC((v) => !v)}
            aria-label="Mostrar u ocultar comentarios"
            style={{
              background: "none",
              border: "none",
              color: "#64748b",
              cursor: "pointer",
              fontSize: 15,
              padding: 0,
            }}
          >
            💬 {post.comments.length}
          </button>

          {cu && isNavigableRoute(post) && (
            <button
              onClick={() => onToggleSaved(post.id)}
              style={{
                background: "none",
                border: "none",
                color: saved ? "#f59e0b" : "#64748b",
                cursor: "pointer",
                fontSize: 15,
                padding: 0,
              }}
            >
              {saved ? "⭐ Guardada" : "⭐ Guardar"}
            </button>
          )}

          <button
            onClick={handleShare}
            disabled={shareStatus === 'sharing'}
            style={{
              background: "none",
              border: "none",
              color: shareStatus === 'copied' || shareStatus === 'shared' ? "#22c55e" : "#64748b",
              cursor: "pointer",
              fontSize: 15,
              padding: 0,
            }}
          >
            {shareStatus === 'sharing' ? '⏳' : 
             shareStatus === 'copied' ? '✅ Copiado' : 
             shareStatus === 'shared' ? '✅ Compartido' :
             shareStatus === 'error' ? '❌ Error' : '🔗 Compartir'}
          </button>

          <button
            onClick={() => goPostId(post.id)}
            style={{
              background: "none",
              border: "none",
              color: "#f59e0b",
              cursor: "pointer",
              fontSize: 13,
              padding: 0,
              marginLeft: "auto",
            }}
          >
            {hasMap ? "Ver ruta completa →" : "Ver detalle →"}
          </button>
        </div>

        {cu && isNavigableRoute(post) && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
            <button onClick={() => onOpenNavigatorModal(post.id)} style={{ ...btn, padding: "8px 12px" }}>
              🚀 Hacer esta ruta
            </button>
          </div>
        )}

        {showC && (
          <div style={{ marginTop: 12 }}>
            {post.comments.map((c) => {
              const cuser = users.find((u) => u.id === c.userId);
              return (
                <div key={c.id} style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                  <Avatar username={cuser?.username} size={24} />
                  <div
                    style={{
                      background: "#0f172a",
                      borderRadius: 8,
                      padding: "6px 10px",
                      flex: 1,
                    }}
                  >
                    <span
                      style={{
                        color: "#f59e0b",
                        fontSize: 12,
                        fontWeight: 600,
                      }}
                    >
                      @{cuser?.username}
                    </span>
                    <p
                      style={{
                        color: "#cbd5e1",
                        fontSize: 13,
                        margin: "2px 0 0",
                      }}
                    >
                      {c.text}
                    </p>
                  </div>
                </div>
              );
            })}

            {cu && (
              <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                <input
                  value={cText}
                  onChange={(e) => setCText(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && submitComment()}
                  placeholder="Comentar…"
                  style={{ ...inp, flex: 1, padding: "6px 10px" }}
                  aria-label="Escribir comentario"
                />
                <button
                  onClick={submitComment}
                  style={{ ...btn, padding: "6px 12px" }}
                  aria-label="Enviar comentario"
                >
                  ↑
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {hasMap && (
        <MiniMap
          points={post.points}
          segmentGeometries={post.segmentGeometries}
          segmentTypes={post.segments?.map((s) => s.roadType)}
        />
      )}
    </div>
  );
}

// ── PostDetail ───────────────────────────────────────────────────────────────
function PostDetail({
  postId,
  posts,
  users,
  cu,
  onComment,
  goProfile,
  onBack,
  savedRoutes,
  onToggleSaved,
  onOpenNavigatorModal,
}) {
  const post = posts.find((p) => p.id === postId);
  const [comment, setComment] = useState("");
  const [shareStatus, setShareStatus] = useState(null);

  if (!post) return null;

  const author = users.find((u) => u.id === post.userId);
  const meta = TYPE_META[post.type];
  const routePost = isRouteType(post.type);

  const submitComment = () => {
    if (!comment.trim()) return;
    onComment(post.id, comment.trim());
    setComment("");
  };

  const handleShare = async () => {
    setShareStatus('sharing');
    const result = await shareRoute(post);
    if (result.success) {
      setShareStatus(result.method === 'clipboard' ? 'copied' : 'shared');
      setTimeout(() => setShareStatus(null), 2500);
    } else if (result.method !== 'cancelled') {
      setShareStatus('error');
      setTimeout(() => setShareStatus(null), 2500);
    } else {
      setShareStatus(null);
    }
  };

  return (
    <div>
      <button
        onClick={onBack}
        style={{ ...btn2, padding: "6px 12px", marginBottom: 14 }}
      >
        ← Volver
      </button>

      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 12 }}>
        <div onClick={() => goProfile(author?.id)} style={{ cursor: "pointer" }}>
          <Avatar username={author?.username} size={42} />
        </div>

        <div>
          <span
            style={{ color: "#f8fafc", fontWeight: 700, cursor: "pointer" }}
            onClick={() => goProfile(author?.id)}
          >
            @{author?.username}
          </span>

          {author?.moto && (
            <p style={{ color: "#f59e0b", fontSize: 12, margin: "2px 0 0" }}>
              🏍️ {author.moto.modelo} · {author.moto.cilindrada}cc ·{" "}
              {author.moto.anio}
            </p>
          )}

          <div style={{ color: meta.color, fontSize: 13, marginTop: 2 }}>
            {meta.icon} {meta.label}
            {post.placeType ? ` · ${post.placeType}` : ""}
            {post.eventDate ? ` · 📅 ${post.eventDate}` : ""}
          </div>
        </div>
      </div>

      <h2 style={{ color: "#f1f5f9", marginBottom: 6 }}>{post.title}</h2>
      <p style={{ color: "#94a3b8", marginBottom: 12, lineHeight: 1.6 }}>
        {post.desc}
      </p>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 12 }}>
        {post.tags.map((t) => (
          <Badge key={t} tag={t} />
        ))}
      </div>

      {routePost && post.totalKm > 0 && (
        <RouteSummary
          totalKm={post.totalKm}
          provinces={post.provinces}
          segments={post.segments}
          segmentKm={post.segmentKm}
        />
      )}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 16 }}>
        <button
          onClick={handleShare}
          disabled={shareStatus === 'sharing'}
          style={{
            ...btn,
            padding: "10px 14px",
            background: shareStatus === 'copied' || shareStatus === 'shared' ? "#22c55e" : "#f59e0b",
          }}
        >
          {shareStatus === 'sharing' ? '⏳ Compartiendo...' : 
           shareStatus === 'copied' ? '✅ Link copiado!' : 
           shareStatus === 'shared' ? '✅ Compartido!' :
           shareStatus === 'error' ? '❌ Error' : '🔗 Compartir ruta'}
        </button>
      </div>

      <RouteActions
        post={post}
        currentUser={cu}
        savedRoutes={savedRoutes}
        onToggleSaved={onToggleSaved}
        onOpenNavigatorModal={onOpenNavigatorModal}
      />

      <div style={{ marginTop: 12 }}>
        <MapPicker
          points={post.points}
          onChange={() => {}}
          readonly={true}
          segmentGeometries={post.segmentGeometries}
          segmentTypes={post.segments?.map((s) => s.roadType)}
        />
      </div>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
        {post.points.map((p, i) => (
          <span
            key={i}
            style={{
              background: "#0f172a",
              color: "#94a3b8",
              borderRadius: 99,
              padding: "4px 12px",
              fontSize: 12,
            }}
          >
            {i === 0
              ? "🟢"
              : i === post.points.length - 1 && post.points.length > 1
                ? "🔴"
                : "🟡"}{" "}
            {p.label}
            {post.segmentKm?.[i] !== undefined && i < post.points.length - 1
              ? ` · ${Math.round(post.segmentKm[i])}km →`
              : ""}
          </span>
        ))}
      </div>

      {post.segments?.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
          {post.segments.map((s, i) => (
            <span key={i} style={{ color: "#64748b", fontSize: 12 }}>
              Tramo {i + 1}: <RoadTypeBadge value={s.roadType} />
            </span>
          ))}
        </div>
      )}

      <div style={{ marginTop: 16 }}>
        <h4 style={{ color: "#64748b", fontWeight: 600, marginBottom: 10 }}>
          💬 Comentarios ({post.comments.length})
        </h4>

        {post.comments.map((c) => {
          const cuser = users.find((u) => u.id === c.userId);
          return (
            <div key={c.id} style={{ display: "flex", gap: 8, marginBottom: 10 }}>
              <Avatar username={cuser?.username} size={28} />
              <div
                style={{
                  background: "#1e293b",
                  borderRadius: 10,
                  padding: "8px 12px",
                  flex: 1,
                }}
              >
                <span
                  style={{ color: "#f59e0b", fontSize: 12, fontWeight: 600 }}
                >
                  @{cuser?.username}
                </span>
                <p style={{ color: "#cbd5e1", fontSize: 14, margin: "4px 0 0" }}>
                  {c.text}
                </p>
              </div>
            </div>
          );
        })}

        {cu && (
          <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
            <input
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submitComment()}
              placeholder="Escribí un comentario…"
              style={{ ...inp, flex: 1 }}
              aria-label="Escribir comentario en detalle"
            />
            <button
              onClick={submitComment}
              style={{ ...btn, padding: "8px 14px" }}
              aria-label="Enviar comentario"
            >
              ↑
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── ProfileView ──────────────────────────────────────────────────────────────
function ProfileView({
  profileId,
  users,
  posts,
  cu,
  onFollow,
  onLike,
  onComment,
  goPostId,
  goProfile,
  onLogout,
  onBack,
  savedRoutes,
  onToggleSaved,
  onOpenNavigatorModal,
}) {
  const profile = users.find((u) => u.id === profileId);
  if (!profile) return null;

  const isOwn = cu?.id === profile.id;
  const isFollowing = cu?.following?.includes(profile.id);
  const userPosts = posts.filter((p) => p.userId === profile.id);

  return (
    <div>
      <button
        onClick={onBack}
        style={{ ...btn2, padding: "6px 12px", marginBottom: 14 }}
      >
        ← Volver
      </button>

      <div style={{ textAlign: "center", marginBottom: 20 }}>
        <div style={{ display: "flex", justifyContent: "center" }}>
          <Avatar username={profile.username} size={68} />
        </div>

        <h2 style={{ color: "#f1f5f9", margin: "10px 0 2px" }}>
          @{profile.username}
        </h2>

        {profile.moto && (
          <p style={{ color: "#f59e0b", fontSize: 14, margin: "0 0 10px" }}>
            🏍️ {profile.moto.modelo} · {profile.moto.cilindrada}cc ·{" "}
            {profile.moto.anio}
          </p>
        )}

        <div
          style={{
            display: "flex",
            justifyContent: "center",
            gap: 24,
            color: "#64748b",
            fontSize: 14,
            marginBottom: 14,
          }}
        >
          <span>
            <strong style={{ color: "#f1f5f9" }}>{userPosts.length}</strong>{" "}
            publicaciones
          </span>
          <span>
            <strong style={{ color: "#f1f5f9" }}>
              {profile.followers?.length || 0}
            </strong>{" "}
            seguidores
          </span>
          <span>
            <strong style={{ color: "#f1f5f9" }}>
              {profile.following?.length || 0}
            </strong>{" "}
            siguiendo
          </span>
        </div>

        {!isOwn && cu && (
          <button
            onClick={() => onFollow(profile.id)}
            style={{ ...(isFollowing ? btn2 : btn), padding: "8px 28px" }}
          >
            {isFollowing ? "Dejar de seguir" : "Seguir"}
          </button>
        )}

        {isOwn && (
          <button onClick={onLogout} style={{ ...btn2, padding: "8px 20px" }}>
            Cerrar sesión
          </button>
        )}
      </div>

      <h3 style={{ color: "#94a3b8", fontSize: 14, marginBottom: 12 }}>
        Publicaciones de @{profile.username}
      </h3>

      {userPosts.length === 0 && (
        <p style={{ color: "#64748b" }}>Sin publicaciones aún.</p>
      )}

      {userPosts.map((p) => (
        <PostCard
          key={p.id}
          post={p}
          cu={cu}
          users={users}
          onLike={onLike}
          onComment={onComment}
          goProfile={goProfile}
          goPostId={goPostId}
          savedRoutes={savedRoutes}
          onToggleSaved={onToggleSaved}
          onOpenNavigatorModal={onOpenNavigatorModal}
        />
      ))}
    </div>
  );
}

// ── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [users, setUsers] = useState(getInitialUsers);
  const [posts, setPosts] = useState(getInitialPosts);
  const [session, setSession] = useState(getInitialSession);
  const [savedRoutes, setSavedRoutes] = useState(getInitialSavedRoutes);

  const [view, setView] = useState("feed");
  const [navStack, setNavStack] = useState([]);

  const [authMode, setAuthMode] = useState("login");
  const [authF, setAuthF] = useState({
    email: "",
    username: "",
    pass: "",
    modelo: "",
    cilindrada: "",
    anio: "",
  });
  const [authErr, setAuthErr] = useState("");

  const [homeFilters, setHomeFilters] = useState(EMPTY_FILTERS);
  const [exploreFilters, setExploreFilters] = useState(EMPTY_FILTERS);
  const [showHomeAdvanced, setShowHomeAdvanced] = useState(false);

  const debouncedHomeText = useDebouncedValue(homeFilters.text, 250);
  const debouncedExploreText = useDebouncedValue(exploreFilters.text, 250);

  const [np, setNp] = useState(EMPTY_NP);
  const [npStep, setNpStep] = useState(1);

  const [activePostId, setActivePostId] = useState(null);
  const [activeProfileId, setActiveProfileId] = useState(null);
  const [navigatorPostId, setNavigatorPostId] = useState(null);
  const [activeNavigation, setActiveNavigation] = useState(null);

  const [deletedPointInfo, setDeletedPointInfo] = useState(null);
  const routeReqIdRef = useRef(0);

  const cu = session ? users.find((u) => u.id === session.id) : null;
  const navigatorPost = navigatorPostId ? posts.find((p) => p.id === navigatorPostId) : null;
  const activeNavigationPost = activeNavigation ? posts.find((p) => p.id === activeNavigation.postId) : null;

  useEffect(() => {
    LS.set("br_users", users);
  }, [users]);

  useEffect(() => {
    LS.set("br_posts", posts);
  }, [posts]);

  useEffect(() => {
    LS.set("br_session", session);
  }, [session]);

  useEffect(() => {
    LS.set("br_saved_routes", savedRoutes);
  }, [savedRoutes]);

  useEffect(() => {
    if (!deletedPointInfo) return;
    const t = setTimeout(() => setDeletedPointInfo(null), 5000);
    return () => clearTimeout(t);
  }, [deletedPointInfo]);

  // Audio is now manual only - triggered by 🎵 button in header

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

  const goProfile = (id) => {
    openView("profile", () => setActiveProfileId(id));
  };

  const goPostId = (id) => {
    openView("post", () => setActivePostId(id));
  };

  const resetAuthForm = () =>
    setAuthF({
      email: "",
      username: "",
      pass: "",
      modelo: "",
      cilindrada: "",
      anio: "",
    });

  const handleAuth = () => {
    setAuthErr("");

    if (authMode === "login") {
      const u = users.find(
        (u) => u.email === authF.email && u.pass === authF.pass
      );
      if (!u) return setAuthErr("Email o contraseña incorrectos");
      setSession({ id: u.id });
      resetAuthForm();
      setView("feed");
      setNavStack([]);
      return;
    }

    if (!authF.email || !authF.username || !authF.pass) {
      return setAuthErr("Completá todos los campos");
    }
    if (!authF.modelo || !authF.cilindrada || !authF.anio) {
      return setAuthErr("Completá los datos de tu moto");
    }
    if (users.find((u) => u.email === authF.email)) {
      return setAuthErr("Email ya registrado");
    }
    if (users.find((u) => u.username === authF.username)) {
      return setAuthErr("Usuario no disponible");
    }

    const u = {
      id: uid(),
      username: authF.username,
      email: authF.email,
      pass: authF.pass,
      followers: [],
      following: [],
      moto: {
        modelo: authF.modelo,
        cilindrada: authF.cilindrada,
        anio: authF.anio,
      },
    };

    setUsers((prev) => [...prev, u]);
    setSession({ id: u.id });
    resetAuthForm();
    setView("feed");
    setNavStack([]);
  };

  const handleLike = (id) => {
    if (!cu) return;
    setPosts((prev) =>
      prev.map((p) => {
        if (p.id !== id) return p;
        const likes = p.likes.includes(cu.id)
          ? p.likes.filter((x) => x !== cu.id)
          : [...p.likes, cu.id];
        return { ...p, likes };
      })
    );
  };

  const handleComment = (id, text) => {
    if (!cu) return;
    setPosts((prev) =>
      prev.map((p) =>
        p.id !== id
          ? p
          : {
              ...p,
              comments: [
                ...p.comments,
                { id: uid(), userId: cu.id, text, createdAt: Date.now() },
              ],
            }
      )
    );
  };

  const handleFollow = (targetId) => {
    if (!cu || targetId === cu.id) return;
    const already = cu.following.includes(targetId);

    setUsers((prev) =>
      prev.map((u) => {
        if (u.id === cu.id) {
          return {
            ...u,
            following: already
              ? u.following.filter((x) => x !== targetId)
              : [...u.following, targetId],
          };
        }
        if (u.id === targetId) {
          return {
            ...u,
            followers: already
              ? u.followers.filter((x) => x !== cu.id)
              : [...u.followers, cu.id],
          };
        }
        return u;
      })
    );
  };

  const toggleSavedRoute = (postId) => {
    if (!cu) return;
    const existing = savedRoutes.find((r) => r.userId === cu.id && r.postId === postId);
    if (existing) {
      setSavedRoutes((prev) => prev.filter((r) => r.id !== existing.id));
      if (activeNavigation?.savedRouteId === existing.id) {
        setActiveNavigation(null);
      }
      return;
    }

    setSavedRoutes((prev) => [
      {
        id: uid(),
        userId: cu.id,
        postId,
        savedAt: Date.now(),
        status: "saved",
        completedAt: null,
      },
      ...prev,
    ]);
  };

  const markSavedRouteCompleted = (savedRouteId) => {
    setSavedRoutes((prev) =>
      prev.map((r) =>
        r.id === savedRouteId
          ? { ...r, status: "completed", completedAt: Date.now() }
          : r
      )
    );
  };

  const openNavigatorModal = (postId) => {
    setNavigatorPostId(postId);
  };

  const closeNavigatorModal = () => setNavigatorPostId(null);

  const startNavigation = (savedRouteId, postId) => {
    setSavedRoutes((prev) =>
      prev.map((r) =>
        r.id === savedRouteId
          ? { ...r, status: "active" }
          : r
      )
    );
    setActiveNavigation({ savedRouteId, postId });
  };

  const startNavigationForPost = (postId) => {
    if (!cu) return;
    let saved = savedRoutes.find((r) => r.userId === cu.id && r.postId === postId);

    if (!saved) {
      saved = {
        id: uid(),
        userId: cu.id,
        postId,
        savedAt: Date.now(),
        status: "active",
        completedAt: null,
      };
      setSavedRoutes((prev) => [saved, ...prev]);
    } else {
      setSavedRoutes((prev) =>
        prev.map((r) => (r.id === saved.id ? { ...r, status: "active" } : r))
      );
    }

    setActiveNavigation({ savedRouteId: saved.id, postId });
    setNavigatorPostId(null);
  };

  const completeActiveNavigation = () => {
    if (!activeNavigation) return;
    markSavedRouteCompleted(activeNavigation.savedRouteId);
  };

  const addTag = () => {
    const tag = np.tagInput.trim().toLowerCase();
    if (tag && !np.tags.includes(tag)) {
      setNp((prev) => ({ ...prev, tags: [...prev.tags, tag], tagInput: "" }));
    } else {
      setNp((prev) => ({ ...prev, tagInput: "" }));
    }
  };

  const updatePoints = (pts) => {
    const segCount = Math.max(0, pts.length - 1);
    const segs = Array.from(
      { length: segCount },
      (_, i) => np.segments[i] || { roadType: "asfalto" }
    );

    setNp((prev) =>
      resetRouteDerived({
        ...prev,
        points: pts,
        segments: segs,
      })
    );
  };

  const insertPointAt = (points, point, index) => {
    const next = [...points];
    next.splice(index, 0, point);
    return normalizePoints(next);
  };

  const handleDeletedPoint = ({ point, index }) => {
    setDeletedPointInfo({ point, index });
  };

  const undoDeletedPoint = () => {
    if (!deletedPointInfo) return;
    const restored = insertPointAt(
      np.points,
      deletedPointInfo.point,
      deletedPointInfo.index
    );
    updatePoints(restored);
    setDeletedPointInfo(null);
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

      const provinceResults = await Promise.all(np.points.map((p) => fetchProvince(p)));
      if (reqId !== routeReqIdRef.current) return;

      const provinces = [...new Set(provinceResults.filter(Boolean))];
      const totalKm = Math.round(kms.reduce((a, b) => a + b, 0) * 10) / 10;

      setNp((prev) => {
        if (reqId !== routeReqIdRef.current) return prev;
        return {
          ...prev,
          segmentGeometries: geometries,
          segmentKm: kms,
          totalKm,
          provinces,
          computing: false,
          routeError: "",
        };
      });
    } catch (e) {
      if (reqId !== routeReqIdRef.current) return;
      setNp((prev) => ({
        ...prev,
        computing: false,
        routeError: e.message || "No se pudo calcular la ruta.",
      }));
    }
  };

  const submitPost = () => {
    if (!cu) return;
    if (!np.title.trim() || np.points.length === 0) return;

    const post = {
      id: uid(),
      type: np.type,
      userId: cu.id,
      title: np.title,
      desc: np.desc,
      tags: np.tags,
      points: np.points,
      segments: np.segments,
      segmentGeometries: np.segmentGeometries,
      segmentKm: np.segmentKm,
      totalKm: np.totalKm,
      provinces: np.provinces,
      likes: [],
      comments: [],
      createdAt: Date.now(),
      ...(np.type === "lugar" ? { placeType: np.placeType } : {}),
      ...(np.type === "evento" ? { eventDate: np.eventDate } : {}),
    };

    setPosts((prev) => [post, ...prev]);
    setNp(EMPTY_NP);
    setNpStep(1);
    setDeletedPointInfo(null);
    setView("feed");
    setNavStack([]);
  };

  const draftIsRoute = isRouteType(np.type);
  const routeComputed = np.segmentGeometries.length > 0;

  const canPublish =
    !!np.title.trim() &&
    np.points.length > 0 &&
    !(np.type === "lugar" && !np.placeType) &&
    !(np.type === "evento" && !np.eventDate) &&
    !(draftIsRoute && np.points.length >= 2 && !routeComputed);

  const allTags = useMemo(
    () => [...new Set(posts.flatMap((p) => p.tags))],
    [posts]
  );

  const allProvinces = useMemo(
    () =>
      [...new Set(posts.flatMap((p) => p.provinces || []).filter(Boolean))].sort(),
    [posts]
  );

  const applyFilters = (list, filters, debouncedText) => {
    const minLikes = filters.minLikes === "" ? null : Number(filters.minLikes);
    const minKm = filters.minKm === "" ? null : Number(filters.minKm);
    const maxKm = filters.maxKm === "" ? null : Number(filters.maxKm);

    return list
      .filter((p) => {
        if (filters.type !== "all" && p.type !== filters.type) return false;

        if (
          filters.tag &&
          !p.tags.some((t) =>
            t.toLowerCase().includes(filters.tag.toLowerCase())
          )
        ) {
          return false;
        }

        if (
          debouncedText &&
          !p.title.toLowerCase().includes(debouncedText.toLowerCase()) &&
          !p.desc.toLowerCase().includes(debouncedText.toLowerCase())
        ) {
          return false;
        }

        if (
          filters.province &&
          !(p.provinces || []).some(
            (prov) => prov.toLowerCase() === filters.province.toLowerCase()
          )
        ) {
          return false;
        }

        if (minLikes !== null && (p.likes?.length || 0) < minLikes) return false;
        if (minKm !== null && (p.totalKm || 0) < minKm) return false;
        if (maxKm !== null && (p.totalKm || 0) > maxKm) return false;

        return true;
      })
      .sort((a, b) => {
        if (filters.sortBy === "likes") {
          return (b.likes?.length || 0) - (a.likes?.length || 0);
        }
        if (filters.sortBy === "km") {
          return (b.totalKm || 0) - (a.totalKm || 0);
        }
        return b.createdAt - a.createdAt;
      });
  };

  const filteredHome = useMemo(
    () => applyFilters(posts, homeFilters, debouncedHomeText),
    [posts, homeFilters, debouncedHomeText]
  );

  const filteredExplore = useMemo(
    () => applyFilters(posts, exploreFilters, debouncedExploreText),
    [posts, exploreFilters, debouncedExploreText]
  );

  const homeHasActiveFilters = useMemo(() => {
    return !!(
      homeFilters.text ||
      homeFilters.province ||
      homeFilters.tag ||
      homeFilters.minLikes ||
      homeFilters.minKm ||
      homeFilters.maxKm ||
      homeFilters.type !== "all" ||
      homeFilters.sortBy !== "recent"
    );
  }, [homeFilters]);

  const heroPost = useMemo(() => posts.find((p) => p.id === "p1") || posts[0], [posts]);
  const popularRoutes = useMemo(
    () => posts.filter(isNavigableRoute).slice().sort((a, b) => (b.likes?.length || 0) - (a.likes?.length || 0)).slice(0, 3),
    [posts]
  );
  const longRoutes = useMemo(
    () => posts.filter(isNavigableRoute).slice().sort((a, b) => (b.totalKm || 0) - (a.totalKm || 0)).slice(0, 3),
    [posts]
  );
  const freshRoutes = useMemo(
    () => posts.filter(isNavigableRoute).slice().sort((a, b) => b.createdAt - a.createdAt).slice(0, 3),
    [posts]
  );

  const inNav = !["auth", "new", "post", "profile"].includes(view);

  return (
    <div
      style={{
        background: "#0f172a",
        minHeight: "100vh",
        color: "#f1f5f9",
        fontFamily: "system-ui,sans-serif",
        maxWidth: 480,
        margin: "0 auto",
      }}
    >
      <audio data-landing-intro="true" preload="none" src={LANDING_AUDIO_SRC} />
      <div
        style={{
          background: "#1e293b",
          padding: "12px 16px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          position: "sticky",
          top: 0,
          zIndex: 100,
          borderBottom: "1px solid #334155",
        }}
      >
        <span
          style={{
            fontWeight: 800,
            fontSize: 20,
            color: "#f59e0b",
            cursor: "pointer",
          }}
          onClick={() => {
            setView("feed");
            setNavStack([]);
          }}
        >
          🏍️ BuenaRuta
        </span>

        <button
          onClick={() => {
            const audio = document.querySelector('audio[data-landing-intro="true"]');
            if (audio) {
              if (audio.paused) {
                audio.volume = 0.85;
                audio.currentTime = 0;
                audio.play().catch(() => {});
              } else {
                audio.pause();
              }
            }
          }}
          onMouseEnter={() => {
            const audio = document.querySelector('audio[data-landing-intro="true"]');
            if (audio) audio.load();
          }}
          aria-label="Reproducir audio de intro"
          style={{
            background: "none",
            border: "none",
            fontSize: 18,
            cursor: "pointer",
            padding: "4px 8px",
            opacity: 0.8,
            transition: "opacity 0.2s",
          }}
          onMouseOver={(e) => e.currentTarget.style.opacity = 1}
          onMouseOut={(e) => e.currentTarget.style.opacity = 0.8}
        >
          🎵
        </button>

        <div style={{ display: "flex", gap: 8, alignItems: "center", marginLeft: "auto" }}>
          {cu ? (
            <>
              <button
                onClick={() => {
                  openView("new", () => {
                    setNp(EMPTY_NP);
                    setNpStep(1);
                    setDeletedPointInfo(null);
                  });
                }}
                style={{ ...btn, padding: "6px 12px", fontSize: 13 }}
              >
                + Publicar
              </button>
              <div onClick={() => goProfile(cu.id)} style={{ cursor: "pointer" }}>
                <Avatar username={cu.username} size={30} />
              </div>
            </>
          ) : (
            <button
              onClick={() => openView("auth")}
              style={{ ...btn, padding: "6px 14px" }}
            >
              Entrar
            </button>
          )}
        </div>
      </div>

      {inNav && (
        <div
          style={{
            display: "flex",
            background: "#1e293b",
            borderBottom: "2px solid #0f172a",
          }}
        >
          {[ ["feed", "🏠 Home"], ["explore", "🔍 Explorar"] ].map(([v, l]) => (
            <button
              key={v}
              onClick={() => {
                setView(v);
                setNavStack([]);
              }}
              style={{
                flex: 1,
                padding: "10px 0",
                background: "none",
                border: "none",
                borderBottom:
                  view === v ? "2px solid #f59e0b" : "2px solid transparent",
                color: view === v ? "#f59e0b" : "#64748b",
                fontWeight: view === v ? 700 : 400,
                cursor: "pointer",
                fontSize: 14,
              }}
            >
              {l}
            </button>
          ))}
        </div>
      )}

      <div style={{ padding: 16, paddingBottom: 90 }}>
        {view === "auth" && (
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
              <button
                onClick={goBack}
                style={{ ...btn2, padding: "6px 10px" }}
              >
                ←
              </button>
              <h2 style={{ margin: 0, color: "#f59e0b" }}>
                {authMode === "login" ? "Iniciar sesión" : "Crear cuenta"}
              </h2>
            </div>

            {authMode === "register" && (
              <>
                <input
                  placeholder="Nombre de usuario"
                  style={{ ...inp, marginBottom: 10 }}
                  value={authF.username}
                  onChange={(e) =>
                    setAuthF({ ...authF, username: e.target.value })
                  }
                />

                <div
                  style={{
                    border: "1px solid #334155",
                    borderRadius: 10,
                    padding: 12,
                    marginBottom: 10,
                  }}
                >
                  <p style={{ color: "#64748b", fontSize: 13, margin: "0 0 8px" }}>
                    🏍️ Tu moto (obligatorio)
                  </p>

                  <input
                    placeholder="Modelo (ej: Honda CB 500)"
                    style={{ ...inp, marginBottom: 8 }}
                    value={authF.modelo}
                    onChange={(e) =>
                      setAuthF({ ...authF, modelo: e.target.value })
                    }
                  />

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    <input
                      placeholder="Cilindrada (cc)"
                      type="number"
                      style={inp}
                      value={authF.cilindrada}
                      onChange={(e) =>
                        setAuthF({ ...authF, cilindrada: e.target.value })
                      }
                    />
                    <input
                      placeholder="Año"
                      type="number"
                      style={inp}
                      value={authF.anio}
                      onChange={(e) =>
                        setAuthF({ ...authF, anio: e.target.value })
                      }
                    />
                  </div>
                </div>
              </>
            )}

            <input
              placeholder="Email"
              type="email"
              style={{ ...inp, marginBottom: 10 }}
              value={authF.email}
              onChange={(e) => setAuthF({ ...authF, email: e.target.value })}
            />

            <input
              placeholder="Contraseña"
              type="password"
              style={{ ...inp, marginBottom: 10 }}
              value={authF.pass}
              onChange={(e) => setAuthF({ ...authF, pass: e.target.value })}
              onKeyDown={(e) => e.key === "Enter" && handleAuth()}
            />

            {authErr && (
              <p style={{ color: "#ef4444", fontSize: 13, marginBottom: 8 }}>
                {authErr}
              </p>
            )}

            <button
              onClick={handleAuth}
              style={{ ...btn, width: "100%", padding: 12 }}
            >
              {authMode === "login" ? "Entrar" : "Registrarme"}
            </button>

            <p
              style={{
                color: "#64748b",
                textAlign: "center",
                marginTop: 14,
                fontSize: 14,
              }}
            >
              {authMode === "login"
                ? "¿No tenés cuenta? "
                : "¿Ya tenés cuenta? "}
              <span
                style={{ color: "#f59e0b", cursor: "pointer" }}
                onClick={() =>
                  setAuthMode(authMode === "login" ? "register" : "login")
                }
              >
                {authMode === "login" ? "Registrate" : "Iniciá sesión"}
              </span>
            </p>

            <p
              style={{
                color: "#475569",
                fontSize: 12,
                textAlign: "center",
                marginTop: 12,
              }}
            >
              Demo: moto@example.com / 1234
            </p>
          </div>
        )}

        {view === "feed" && (
          <div>
            <HomeHero
              post={heroPost}
              currentUser={cu}
              savedRoutes={savedRoutes}
              onToggleSaved={toggleSavedRoute}
              onOpenNavigatorModal={openNavigatorModal}
              onOpenPost={goPostId}
              onExplore={() => {
                setExploreFilters(homeFilters);
                setView("explore");
                setNavStack([]);
              }}
            />

            {cu && (
              <SavedRoutesPanel
                currentUser={cu}
                savedRoutes={savedRoutes}
                posts={posts}
                users={users}
                onOpenPost={goPostId}
                onStartNavigation={startNavigation}
                onToggleSaved={toggleSavedRoute}
                onMarkCompleted={markSavedRouteCompleted}
              />
            )}

            <HomeQuickFilters
              filters={homeFilters}
              setFilters={setHomeFilters}
              allProvinces={allProvinces}
              showAdvanced={showHomeAdvanced}
              setShowAdvanced={setShowHomeAdvanced}
              allTags={allTags}
              onExplore={() => {
                setExploreFilters(homeFilters);
                setView("explore");
                setNavStack([]);
              }}
            />

            {homeHasActiveFilters ? (
              <HomeSection
                title="Resultados en Home"
                subtitle="Rutas filtradas para salir a rodar"
                posts={filteredHome}
                currentUser={cu}
                savedRoutes={savedRoutes}
                onToggleSaved={toggleSavedRoute}
                onOpenNavigatorModal={openNavigatorModal}
                onOpenPost={goPostId}
              />
            ) : (
              <>
                <HomeSection
                  title="Rutas que hacen flashear"
                  subtitle="Las más guardables y compartibles para arrancar fuerte"
                  posts={popularRoutes}
                  currentUser={cu}
                  savedRoutes={savedRoutes}
                  onToggleSaved={toggleSavedRoute}
                  onOpenNavigatorModal={openNavigatorModal}
                  onOpenPost={goPostId}
                />
                <HomeSection
                  title="Para meter viaje largo"
                  subtitle="Más kilómetros, más paisaje, más épica"
                  posts={longRoutes}
                  currentUser={cu}
                  savedRoutes={savedRoutes}
                  onToggleSaved={toggleSavedRoute}
                  onOpenNavigatorModal={openNavigatorModal}
                  onOpenPost={goPostId}
                />
                <HomeSection
                  title="Recientes para salir hoy"
                  subtitle="Semillas reales para arrancar a usar BuenaRuta"
                  posts={freshRoutes}
                  currentUser={cu}
                  savedRoutes={savedRoutes}
                  onToggleSaved={toggleSavedRoute}
                  onOpenNavigatorModal={openNavigatorModal}
                  onOpenPost={goPostId}
                />
              </>
            )}

            {!cu && (
              <div
                style={{
                  background: "#1e293b",
                  borderRadius: 12,
                  padding: 16,
                  marginTop: 8,
                  textAlign: "center",
                  border: "1px solid #334155",
                }}
              >
                <p style={{ color: "#94a3b8", marginBottom: 10 }}>
                  Guardá rutas, marcá viajes hechos y abrí navegación cuando quieras.
                </p>
                <button
                  onClick={() => openView("auth")}
                  style={{ ...btn, padding: "10px 24px" }}
                >
                  Crear cuenta gratis
                </button>
              </div>
            )}
          </div>
        )}

        {view === "explore" && (
          <div>
            <FeedFilters
              filters={exploreFilters}
              setFilters={setExploreFilters}
              allTags={allTags}
              allProvinces={allProvinces}
              title="Explorar rutas, lugares y eventos"
            />

            {filteredExplore.length === 0 && (
              <p style={{ color: "#64748b", textAlign: "center", marginTop: 30 }}>
                Sin resultados.
              </p>
            )}

            {filteredExplore.map((p) => (
              <PostCard
                key={p.id}
                post={p}
                cu={cu}
                users={users}
                onLike={handleLike}
                onComment={handleComment}
                goProfile={goProfile}
                goPostId={goPostId}
                savedRoutes={savedRoutes}
                onToggleSaved={toggleSavedRoute}
                onOpenNavigatorModal={openNavigatorModal}
              />
            ))}
          </div>
        )}

        {view === "new" && cu && (
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
              <button
                onClick={goBack}
                style={{ ...btn2, padding: "6px 10px" }}
              >
                ←
              </button>
              <h2 style={{ margin: 0, color: "#f59e0b" }}>Nueva publicación</h2>
              <span style={{ marginLeft: "auto", color: "#64748b", fontSize: 13 }}>
                Paso {npStep}/2
              </span>
            </div>

            {npStep === 1 && (
              <>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: 8,
                    marginBottom: 14,
                  }}
                >
                  {Object.entries(TYPE_META).map(([k, v]) => (
                    <button
                      key={k}
                      onClick={() => setNp((prev) => ({ ...prev, type: k }))}
                      style={{
                        background: np.type === k ? v.color + "22" : "#1e293b",
                        border: `2px solid ${
                          np.type === k ? v.color : "#334155"
                        }`,
                        borderRadius: 10,
                        padding: 14,
                        cursor: "pointer",
                        color: np.type === k ? v.color : "#94a3b8",
                        fontWeight: 600,
                        fontSize: 15,
                      }}
                    >
                      {v.icon} {v.label}
                    </button>
                  ))}
                </div>

                <input
                  placeholder="Título *"
                  style={{ ...inp, marginBottom: 10 }}
                  value={np.title}
                  onChange={(e) => setNp((prev) => ({ ...prev, title: e.target.value }))}
                />

                <textarea
                  placeholder="Descripción"
                  style={{ ...inp, marginBottom: 10, minHeight: 76, resize: "vertical" }}
                  value={np.desc}
                  onChange={(e) => setNp((prev) => ({ ...prev, desc: e.target.value }))}
                />

                {np.type === "lugar" && (
                  <select
                    style={{ ...inp, marginBottom: 10 }}
                    value={np.placeType}
                    onChange={(e) =>
                      setNp((prev) => ({ ...prev, placeType: e.target.value }))
                    }
                  >
                    <option value="">Tipo de lugar * (obligatorio)</option>
                    {PLACE_TYPES.map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </select>
                )}

                {np.type === "evento" && (
                  <input
                    type="date"
                    style={{ ...inp, marginBottom: 10 }}
                    value={np.eventDate}
                    onChange={(e) =>
                      setNp((prev) => ({ ...prev, eventDate: e.target.value }))
                    }
                  />
                )}

                <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
                  <input
                    placeholder="Etiqueta + Enter"
                    style={{ ...inp, flex: 1 }}
                    value={np.tagInput}
                    onChange={(e) =>
                      setNp((prev) => ({ ...prev, tagInput: e.target.value }))
                    }
                    onKeyDown={(e) => e.key === "Enter" && addTag()}
                  />
                  <button onClick={addTag} style={{ ...btn2, padding: "8px 12px" }}>
                    +
                  </button>
                </div>

                <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 16 }}>
                  {np.tags.map((t) => (
                    <Badge
                      key={t}
                      tag={t}
                      onRemove={() =>
                        setNp((prev) => ({
                          ...prev,
                          tags: prev.tags.filter((x) => x !== t),
                        }))
                      }
                    />
                  ))}
                </div>

                <button
                  onClick={() => setNpStep(2)}
                  disabled={!np.title.trim()}
                  style={{
                    ...btn,
                    width: "100%",
                    padding: 12,
                    opacity: !np.title.trim() ? 0.5 : 1,
                  }}
                >
                  Siguiente: Mapa →
                </button>
              </>
            )}

            {npStep === 2 && (
              <>
                <LocationSearch
                  onSelect={(lat, lng) => {
                    const updated = normalizePoints([...np.points, { lat, lng }]);
                    updatePoints(updated);
                  }}
                />

                <p style={{ color: "#64748b", fontSize: 12, marginBottom: 6 }}>
                  Tocá el mapa para agregar puntos · Clic derecho para eliminar
                </p>

                <MapPicker
                  points={np.points}
                  onChange={updatePoints}
                  readonly={false}
                  segmentGeometries={np.segmentGeometries}
                  segmentTypes={np.segments.map((s) => s.roadType)}
                  onDeletePoint={handleDeletedPoint}
                />

                {deletedPointInfo && (
                  <div
                    style={{
                      marginTop: 10,
                      background: "#1e293b",
                      border: "1px solid #334155",
                      borderRadius: 10,
                      padding: "10px 12px",
                      display: "flex",
                      gap: 10,
                      alignItems: "center",
                      justifyContent: "space-between",
                    }}
                  >
                    <span style={{ color: "#cbd5e1", fontSize: 13 }}>
                      Punto eliminado.
                    </span>
                    <button
                      onClick={undoDeletedPoint}
                      style={{ ...btn, padding: "6px 12px", fontSize: 13 }}
                    >
                      Deshacer
                    </button>
                  </div>
                )}

                {draftIsRoute && (
                  <SegmentEditor
                    points={np.points}
                    segments={np.segments}
                    onChange={(segs) =>
                      setNp((prev) => resetRouteDerived({ ...prev, segments: segs }))
                    }
                  />
                )}

                {draftIsRoute && np.points.length >= 2 && (
                  <button
                    onClick={computeRoute}
                    disabled={np.computing}
                    style={{
                      ...btn2,
                      width: "100%",
                      padding: 10,
                      marginTop: 10,
                      opacity: np.computing ? 0.6 : 1,
                    }}
                  >
                    {np.computing
                      ? "⏳ Calculando ruta y provincias…"
                      : routeComputed
                        ? "🔄 Recalcular ruta"
                        : "📐 Calcular ruta por calles *"}
                  </button>
                )}

                {np.routeError && (
                  <p
                    style={{
                      color: "#ef4444",
                      fontSize: 13,
                      marginTop: 6,
                      textAlign: "center",
                    }}
                  >
                    ⚠️ {np.routeError}
                  </p>
                )}

                {routeComputed && (
                  <RouteSummary
                    totalKm={np.totalKm}
                    provinces={np.provinces}
                    segments={np.segments}
                    segmentKm={np.segmentKm}
                  />
                )}

                <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 8 }}>
                  {np.points.map((p, i) => (
                    <span
                      key={i}
                      style={{
                        background: "#1e293b",
                        color: "#94a3b8",
                        borderRadius: 99,
                        padding: "3px 10px",
                        fontSize: 12,
                      }}
                    >
                      {i === 0
                        ? "🟢"
                        : i === np.points.length - 1 && np.points.length > 1
                          ? "🔴"
                          : "🟡"}{" "}
                      {p.label}
                    </span>
                  ))}
                </div>

                {np.points.length > 0 && (
                  <button
                    onClick={() => {
                      setNp((prev) =>
                        resetRouteDerived({
                          ...prev,
                          points: [],
                          segments: [],
                        })
                      );
                      setDeletedPointInfo(null);
                    }}
                    style={{
                      ...btn2,
                      marginTop: 8,
                      padding: "6px 12px",
                      fontSize: 12,
                    }}
                  >
                    🗑 Limpiar puntos
                  </button>
                )}

                <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
                  <button
                    onClick={() => setNpStep(1)}
                    style={{ ...btn2, flex: 1, padding: 12 }}
                  >
                    ← Volver
                  </button>

                  <button
                    onClick={submitPost}
                    disabled={!canPublish}
                    style={{
                      ...btn,
                      flex: 2,
                      padding: 12,
                      opacity: !canPublish ? 0.5 : 1,
                    }}
                  >
                    Publicar 🏍️
                  </button>
                </div>

                {draftIsRoute && np.points.length >= 2 && !routeComputed && (
                  <p
                    style={{
                      color: "#64748b",
                      fontSize: 12,
                      textAlign: "center",
                      marginTop: 8,
                    }}
                  >
                    * Calculá la ruta antes de publicar
                  </p>
                )}
              </>
            )}
          </div>
        )}

        {view === "post" && (
          <PostDetail
            postId={activePostId}
            posts={posts}
            users={users}
            cu={cu}
            onComment={handleComment}
            goProfile={goProfile}
            onBack={goBack}
            savedRoutes={savedRoutes}
            onToggleSaved={toggleSavedRoute}
            onOpenNavigatorModal={openNavigatorModal}
          />
        )}

        {view === "profile" && (
          <ProfileView
            profileId={activeProfileId}
            users={users}
            posts={posts}
            cu={cu}
            onFollow={handleFollow}
            onLike={handleLike}
            onComment={handleComment}
            goPostId={goPostId}
            goProfile={goProfile}
            onLogout={() => {
              setSession(null);
              setView("feed");
              setNavStack([]);
            }}
            onBack={goBack}
            savedRoutes={savedRoutes}
            onToggleSaved={toggleSavedRoute}
            onOpenNavigatorModal={openNavigatorModal}
          />
        )}
      </div>

      {navigatorPost && (
        <NavigatorChooserModal
          post={navigatorPost}
          onClose={closeNavigatorModal}
          onChooseApp={(app) => {
            openExternalNavigator(navigatorPost, app);
            closeNavigatorModal();
          }}
          onStartInternal={() => startNavigationForPost(navigatorPost.id)}
        />
      )}

      {activeNavigationPost && activeNavigation && (
        <ActiveNavigation
          post={activeNavigationPost}
          onClose={() => setActiveNavigation(null)}
          onComplete={completeActiveNavigation}
        />
      )}
    </div>
  );
}

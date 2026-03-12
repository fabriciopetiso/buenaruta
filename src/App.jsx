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

const EMPTY_FILTERS = { type: "all", tag: "", text: "", province: "", minLikes: "", minKm: "", maxKm: "", sortBy: "likes" };

const EMPTY_NP = {
  type: "ruta", title: "", desc: "", tags: [], tagInput: "", points: [], segments: [],
  segmentGeometries: [], segmentKm: [], totalKm: 0, provinces: [], placeType: "", eventDate: "",
  computing: false, routeError: "",
};

const AUDIO_SRC = "/buena-ruta.mp3";

const inp = {
  background: "#0f172a", border: "1px solid #334155", borderRadius: 8, color: "#f1f5f9",
  padding: "10px 12px", fontSize: 14, width: "100%", outline: "none", boxSizing: "border-box",
};
const btn = { background: "#f59e0b", color: "#0f172a", border: "none", borderRadius: 8, fontWeight: 700, cursor: "pointer", fontSize: 14 };
const btn2 = { ...btn, background: "#1e293b", color: "#94a3b8" };
const dangerBtn = { ...btn, background: "#ef4444", color: "#fff" };

// ── Helpers ──────────────────────────────────────────────────────────────────
const normalizePoints = (pts) => pts.map((p, i, arr) => ({
  ...p,
  label: i === 0 ? "Inicio" : i === arr.length - 1 && arr.length > 1 ? "Fin" : `Parada ${i}`,
}));

const resetRouteDerived = (draft) => ({ ...draft, segmentGeometries: [], segmentKm: [], totalKm: 0, provinces: [], computing: false, routeError: "" });
const getRoadMeta = (value) => ROAD_TYPES.find((r) => r.value === value) || ROAD_TYPES[0];
const isRouteType = (type) => type === "ruta" || type === "viaje";
const isNavigableRoute = (post) => !!post && isRouteType(post.type) && Array.isArray(post.points) && post.points.length >= 2;

const haversineKm = (lat1, lng1, lat2, lng2) => {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
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
  const waypoints = post.points.slice(1, -1).map((p) => `${p.lat},${p.lng}`).join("|");
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

// ── Audio helper ─────────────────────────────────────────────────────────────
const playAudio = () => {
  const audio = document.getElementById("br-audio");
  if (audio) {
    audio.currentTime = 0;
    audio.volume = 0.85;
    audio.play().catch(() => {});
  }
};

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
  } catch { return null; }
};

// ── Transform Supabase data to app format ────────────────────────────────────
const transformRoute = (r) => {
  const placeType = r.place_type || null;
  let points = r.points || [];
  // Si es lugar con 1 punto, corregir el label con placeType
  if (r.type === "lugar" && points.length === 1 && placeType) {
    points = [{ ...points[0], label: placeType }];
  }
  return {
    id: r.id,
    type: r.type,
    userId: r.user_id,
    title: r.title,
    desc: r.description,
    tags: r.tags || [],
    points,
    segments: r.segments || [],
    segmentGeometries: r.segment_geometries || [],
    segmentKm: r.segment_km || [],
    totalKm: r.total_km || 0,
    provinces: r.provinces || [],
    placeType,
    eventDate: r.event_date,
    likes: (r.route_likes || []).map((l) => l.user_id),
    comments: (r.route_comments || []).map((c) => ({
      id: c.id,
      odId: c.user_id,
      text: c.text,
      createdAt: new Date(c.created_at).getTime(),
      username: c.profiles?.username || "usuario",
    })),
    createdAt: new Date(r.created_at).getTime(),
    author: r.profiles ? {
      id: r.profiles.id,
      username: r.profiles.username,
      moto: r.profiles.moto_modelo ? {
        modelo: r.profiles.moto_modelo,
        cilindrada: r.profiles.moto_cilindrada,
        anio: r.profiles.moto_anio,
      } : null,
    } : null,
  };
};

// ── Hooks ────────────────────────────────────────────────────────────────────
function useOnScreen(ref) {
  const [isIntersecting, setIntersecting] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    // Verificar inmediatamente si ya está visible (antes de que el observer corra)
    const rect = element.getBoundingClientRect();
    const windowHeight = window.innerHeight || document.documentElement.clientHeight;
    const windowWidth = window.innerWidth || document.documentElement.clientWidth;

    const verticallyVisible = rect.top < windowHeight && rect.bottom > 0;
    const horizontallyVisible = rect.left < windowWidth && rect.right > 0;

    if (verticallyVisible && horizontallyVisible) {
      setIntersecting(true);
    }

    // Observer para cambios futuros
    const observer = new IntersectionObserver(
      ([entry]) => { setIntersecting(entry.isIntersecting); },
      { threshold: 0.1 }
    );

    observer.observe(element);

    return () => observer.disconnect();
  }, [ref]);

  return isIntersecting;
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
function LoadingSpinner() {
  return <div style={{ color: "#f59e0b", fontSize: 18 }}>⏳ Cargando...</div>;
}

function Avatar({ username, size = 32 }) {
  const initials = username ? username.slice(0, 2).toUpperCase() : "?";
  const hue = username ? (username.charCodeAt(0) * 7) % 360 : 200;
  return (
    <div style={{
      width: size, height: size, borderRadius: "50%", background: `hsl(${hue},55%,32%)`,
      color: "#fff", display: "flex", alignItems: "center", justifyContent: "center",
      fontWeight: 700, fontSize: size * 0.38, flexShrink: 0,
    }}>{initials}</div>
  );
}

function Badge({ tag, onRemove }) {
  return (
    <span style={{ background: "#1e293b", color: "#94a3b8", borderRadius: 99, padding: "2px 10px", fontSize: 12, display: "inline-flex", alignItems: "center", gap: 4 }}>
      #{tag}
      {onRemove && <button onClick={onRemove} style={{ background: "none", border: "none", color: "#64748b", cursor: "pointer", padding: 0, lineHeight: 1 }}>×</button>}
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
  (segments || []).forEach((s, i) => { byType[s.roadType] = (byType[s.roadType] || 0) + (segmentKm?.[i] || 0); });
  
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

// ── SavedRoutesPanel ─────────────────────────────────────────────────────────
function SavedRoutesPanel({ savedRoutes, routes, currentUser, onOpenPost, onStartNavigation, onToggleSaved, onMarkCompleted, onOpenNavigatorModal }) {
  if (!currentUser || savedRoutes.length === 0) return null;

  return (
    <div style={{ background: "#1e293b", borderRadius: 12, padding: 12, marginBottom: 14 }}>
      <h3 style={{ margin: "0 0 10px", color: "#f1f5f9", fontSize: 16 }}>⭐ Mis rutas guardadas</h3>
      {savedRoutes.map((saved) => {
        const post = routes.find((p) => p.id === saved.route_id);
        if (!post) return null;
        return (
          <div key={saved.id} style={{ background: "#0f172a", borderRadius: 10, padding: 10, marginBottom: 8, border: "1px solid #334155" }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
              <Avatar username={post.author?.username} size={28} />
              <div style={{ flex: 1 }}>
                <div onClick={() => onOpenPost(post.id)} style={{ color: "#f1f5f9", fontWeight: 700, cursor: "pointer" }}>{post.title}</div>
                <div style={{ color: "#64748b", fontSize: 12 }}>
                  @{post.author?.username} · {post.totalKm || 0} km · {saved.status === "completed" ? "completada" : saved.status === "active" ? "en curso" : "guardada"}
                </div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button onClick={() => { playAudio(); onOpenNavigatorModal(post.id); }} disabled={!isNavigableRoute(post)} style={{ ...btn, padding: "8px 12px", opacity: isNavigableRoute(post) ? 1 : 0.5 }}>🚀 Navegar</button>
              <button onClick={() => onOpenPost(post.id)} style={{ ...btn2, padding: "8px 12px" }}>Ver detalle</button>
              <button onClick={() => onToggleSaved(post.id)} style={{ ...btn2, padding: "8px 12px" }}>Quitar</button>
              {saved.status !== "completed" && <button onClick={() => onMarkCompleted(saved)} style={{ ...btn2, padding: "8px 12px" }}>✅ Marcar hecha</button>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── NavigatorChooserModal ────────────────────────────────────────────────────
function NavigatorChooserModal({ post, onClose, onChooseApp, onStartInternal }) {
  if (!post) return null;
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(2,6,23,0.7)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, zIndex: 2000 }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 420, background: "#1e293b", borderRadius: 16, padding: 16, border: "1px solid #334155" }}>
        <h3 style={{ margin: "0 0 8px", color: "#f8fafc" }}>🚀 Hacer esta ruta</h3>
        <p style={{ color: "#94a3b8", margin: "0 0 14px", fontSize: 14 }}>Elegí si querés abrir la ruta en otra app o usar el modo navegación simple dentro de BuenaRuta.</p>
        <div style={{ display: "grid", gap: 8 }}>
          <button onClick={() => onChooseApp("google")} style={{ ...btn, padding: 12 }}>Abrir en Google Maps</button>
          <button onClick={() => onChooseApp("waze")} style={{ ...btn2, padding: 12 }}>Abrir en Waze</button>
          <button onClick={() => onChooseApp("geo")} style={{ ...btn2, padding: 12 }}>Abrir en app del teléfono</button>
          <button onClick={onStartInternal} style={{ ...btn2, padding: 12 }}>🧭 Navegación simple en BuenaRuta</button>
        </div>
        <button onClick={onClose} style={{ ...btn2, width: "100%", padding: 10, marginTop: 12 }}>Cancelar</button>
      </div>
    </div>
  );
}

// ── NavigationMap ────────────────────────────────────────────────────────────
function NavigationMap({ position, post, remainingPath, trackPoints }) {
  const ref = useRef(null);
  const mapRef = useRef(null);
  const layersRef = useRef([]);

  useEffect(() => {
    let cancelled = false;
    loadLeaflet().then((L) => {
      if (cancelled || !ref.current || mapRef.current) return;
      const center = position ? [position.lat, position.lng] : post?.points?.length ? [post.points[0].lat, post.points[0].lng] : [-31.4, -64.18];
      const map = L.map(ref.current, { zoomControl: true }).setView(center, 11);
      mapRef.current = map;
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: '© OSM', maxZoom: 19 }).addTo(map);
    }).catch(console.error);
    return () => { cancelled = true; };
  }, [post, position]);

  useEffect(() => {
    if (!mapRef.current || !window.L || !post) return;
    const L = window.L;
    layersRef.current.forEach((l) => l.remove?.());
    layersRef.current = [];

    // Full route (gray)
    const fullPath = flattenRoutePath(post);
    if (fullPath.length > 1) {
      layersRef.current.push(L.polyline(fullPath, { color: "#475569", weight: 4, opacity: 0.5 }).addTo(mapRef.current));
    }

    // Remaining path (orange)
    if (remainingPath?.length > 1) {
      layersRef.current.push(L.polyline(remainingPath, { color: "#f59e0b", weight: 5, opacity: 0.95 }).addTo(mapRef.current));
    }

    // Track points (blue - what user actually traveled)
    if (trackPoints?.length > 1) {
      layersRef.current.push(L.polyline(trackPoints.map(p => [p.lat, p.lng]), { color: "#38bdf8", weight: 4, opacity: 0.8 }).addTo(mapRef.current));
    }

    // Waypoints
    post.points.forEach((p, i) => {
      const color = i === 0 ? "#22c55e" : i === post.points.length - 1 ? "#ef4444" : "#f59e0b";
      const icon = L.divIcon({
        html: `<div style="background:${color};width:14px;height:14px;border-radius:50%;border:2px solid #fff;box-shadow:0 1px 5px #0009"></div>`,
        iconSize: [14, 14], iconAnchor: [7, 7], className: "",
      });
      layersRef.current.push(L.marker([p.lat, p.lng], { icon }).bindTooltip(p.label, { permanent: false }).addTo(mapRef.current));
    });

    // Current position
    if (position) {
      layersRef.current.push(L.circleMarker([position.lat, position.lng], { radius: 9, color: "#fff", weight: 2, fillColor: "#38bdf8", fillOpacity: 1 }).addTo(mapRef.current));
      mapRef.current.setView([position.lat, position.lng], 13);
    } else if (post.points?.length > 1) {
      mapRef.current.fitBounds(L.latLngBounds(post.points.map((p) => [p.lat, p.lng])), { padding: [30, 30] });
    }
  }, [position, post, remainingPath, trackPoints]);

  useEffect(() => {
    return () => {
      layersRef.current.forEach((l) => l.remove?.());
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }
    };
  }, []);

  return <div ref={ref} style={{ width: "100%", height: "100%", background: "#0f172a" }} />;
}

// ── ActiveNavigation with GPS Tracking ───────────────────────────────────────
function ActiveNavigation({ post, onClose, onComplete }) {
  const [position, setPosition] = useState(null);
  const [geoErr, setGeoErr] = useState("");
  const [checkpointIndex, setCheckpointIndex] = useState(0);
  const [trackPoints, setTrackPoints] = useState([]);
  const [watchSupported] = useState(() => typeof navigator !== "undefined" && !!navigator.geolocation);

  const path = useMemo(() => flattenRoutePath(post), [post]);
  const nextPoint = post.points[Math.min(checkpointIndex + 1, post.points.length - 1)];
  const distanceToNext = position && nextPoint ? haversineKm(position.lat, position.lng, nextPoint.lat, nextPoint.lng) : null;
  const remainingPath = useMemo(() => position ? [[position.lat, position.lng], ...path] : path, [position, path]);
  const remainingKm = useMemo(() => getRemainingKm(position, path), [position, path]);

  // Calculate tracked distance
  const trackedKm = useMemo(() => {
    if (trackPoints.length < 2) return 0;
    let total = 0;
    for (let i = 1; i < trackPoints.length; i++) {
      total += haversineKm(trackPoints[i-1].lat, trackPoints[i-1].lng, trackPoints[i].lat, trackPoints[i].lng);
    }
    return Math.round(total * 10) / 10;
  }, [trackPoints]);

  useEffect(() => {
    if (!watchSupported) {
      setGeoErr("Geolocalización no disponible en este dispositivo.");
      return;
    }

    let watchId = null;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const newPos = { lat: pos.coords.latitude, lng: pos.coords.longitude, speed: pos.coords.speed, timestamp: Date.now() };
        setPosition(newPos);
        setTrackPoints([newPos]);
      },
      () => setGeoErr("No pude obtener tu ubicación actual."),
      { enableHighAccuracy: true, timeout: 10000 }
    );

    watchId = navigator.geolocation.watchPosition(
      (pos) => {
        setGeoErr("");
        const newPos = { lat: pos.coords.latitude, lng: pos.coords.longitude, speed: pos.coords.speed, timestamp: Date.now() };
        setPosition(newPos);
        // Add to track if moved more than 20 meters
        setTrackPoints(prev => {
          if (prev.length === 0) return [newPos];
          const last = prev[prev.length - 1];
          const dist = haversineKm(last.lat, last.lng, newPos.lat, newPos.lng);
          if (dist > 0.02) return [...prev, newPos];
          return prev;
        });
      },
      () => setGeoErr("No pude seguir tu ubicación en tiempo real."),
      { enableHighAccuracy: true, maximumAge: 3000, timeout: 10000 }
    );

    return () => { if (watchId !== null) navigator.geolocation.clearWatch(watchId); };
  }, [watchSupported]);

  useEffect(() => {
    if (!distanceToNext || distanceToNext > 0.2) return;
    if (checkpointIndex < post.points.length - 1) {
      setCheckpointIndex((prev) => Math.min(prev + 1, post.points.length - 1));
    }
  }, [distanceToNext, checkpointIndex, post.points.length]);

  const finish = () => {
    onComplete(trackPoints, trackedKm);
    onClose();
  };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 3000, background: "#020617", display: "flex", flexDirection: "column" }}>
      <div style={{ padding: 12, background: "#0f172a", borderBottom: "1px solid #334155" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button onClick={onClose} style={{ ...btn2, padding: "8px 12px" }}>✕ Salir</button>
          <div style={{ flex: 1 }}>
            <div style={{ color: "#f8fafc", fontWeight: 700 }}>{post.title}</div>
            <div style={{ color: "#94a3b8", fontSize: 12 }}>Próximo punto: {nextPoint?.label || "Destino"}</div>
          </div>
          <button onClick={finish} style={{ ...btn, padding: "8px 12px" }}>✅ Terminar</button>
        </div>
      </div>

      <div style={{ flex: 1, position: "relative" }}>
        <NavigationMap position={position} post={post} remainingPath={remainingPath} trackPoints={trackPoints} />

        <div style={{ position: "absolute", left: 12, right: 12, bottom: 12, background: "rgba(15, 23, 42, 0.94)", border: "1px solid #334155", borderRadius: 16, padding: 16 }}>
          <div style={{ display: "flex", gap: 16, alignItems: "center", marginBottom: 12 }}>
            <div style={{ fontSize: 44 }}>🧭</div>
            <div style={{ flex: 1 }}>
              <div style={{ color: "#f59e0b", fontWeight: 800, fontSize: 28 }}>{distanceToNext !== null ? `${distanceToNext.toFixed(1)} km` : "—"}</div>
              <div style={{ color: "#cbd5e1", fontSize: 15 }}>hasta {nextPoint?.label || "el destino"}</div>
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{ color: "#f8fafc", fontSize: 24, fontWeight: 800 }}>{position?.speed ? Math.round(position.speed * 3.6) : 0}</div>
              <div style={{ color: "#64748b", fontSize: 12 }}>km/h</div>
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
            <span style={{ color: "#94a3b8", fontSize: 13 }}>🛣️ Restan {remainingKm} km</span>
            <span style={{ color: "#38bdf8", fontSize: 13 }}>📡 Recorrido: {trackedKm} km</span>
            <span style={{ color: "#94a3b8", fontSize: 13 }}>✅ Checkpoint {Math.min(checkpointIndex, post.points.length - 1) + 1}/{post.points.length}</span>
          </div>

          {geoErr && <p style={{ color: "#ef4444", fontSize: 13, margin: "6px 0 10px" }}>{geoErr}</p>}

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button onClick={() => setCheckpointIndex((prev) => Math.min(prev + 1, post.points.length - 1))} style={{ ...btn2, padding: "10px 12px" }}>✅ Llegué al punto</button>
            <button onClick={finish} style={{ ...btn, padding: "10px 12px" }}>Marcar ruta hecha</button>
            <button onClick={onClose} style={{ ...dangerBtn, padding: "10px 12px" }}>Abandonar</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Map shared renderer ──────────────────────────────────────────────────────
const renderMapLayers = (L, map, points, segmentGeometries, segmentTypes, layersRef, readonly, onChange, ptRef, onDeletePoint, onClickMarker) => {
  layersRef.current.forEach((l) => l.remove());
  layersRef.current = [];

  points.forEach((p, i) => {
    const color = i === 0 ? "#22c55e" : i === points.length - 1 && points.length > 1 ? "#ef4444" : "#f59e0b";
    const size = readonly ? 10 : 14;
    const icon = L.divIcon({
      html: `<div style="background:${color};width:${size}px;height:${size}px;border-radius:50%;border:2px solid #fff;box-shadow:0 1px 5px #0009"></div>`,
      iconSize: [size, size], iconAnchor: [size / 2, size / 2], className: "",
    });

    const m = L.marker([p.lat, p.lng], { icon, draggable: !readonly, keyboard: true })
      .bindTooltip(p.label, { permanent: true, direction: "top", offset: [0, -10] })
      .addTo(map);

    if (onClickMarker) {
      m.on("click", () => onClickMarker(p, i));
    }

    if (!readonly && onChange && ptRef) {
      m.on("dragend", (e) => {
        const { lat, lng } = e.target.getLatLng();
        onChange(normalizePoints(ptRef.current.map((x, j) => (j === i ? { ...x, lat, lng } : x))));
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
      const rt = getRoadMeta(segmentTypes?.[i] || "asfalto");
      layersRef.current.push(L.polyline(geo, { color: rt.color, weight: 4, opacity: 0.9 }).addTo(map));
    });
  } else if (points.length > 1) {
    layersRef.current.push(L.polyline(points.map((p) => [p.lat, p.lng]), { color: "#64748b", weight: 3, opacity: 0.5, dashArray: "8,6" }).addTo(map));
  }

  if (points.length > 1) {
    map.fitBounds(L.latLngBounds(points.map((p) => [p.lat, p.lng])), { padding: [30, 30] });
  } else if (points.length === 1) {
    map.setView([points[0].lat, points[0].lng], 14);
  }
};

// ── MiniMap ──────────────────────────────────────────────────────────────────
function MiniMap({ points, segmentGeometries, segmentTypes, lugares = [], placeType }) {
  const wrapperRef = useRef(null);
  const visible = useOnScreen(wrapperRef);
  const ref = useRef(null);
  const mapRef = useRef(null);
  const layersRef = useRef([]);
  const lugaresLayerRef = useRef([]);
  const initializedRef = useRef(false);
  const [mapReady, setMapReady] = useState(false);

  // Efecto 1: init del mapa UNA SOLA VEZ cuando se hace visible
  useEffect(() => {
    if (!visible || initializedRef.current) return;
    let cancelled = false;
    loadLeaflet().then((L) => {
      if (cancelled || !ref.current || mapRef.current) return;
      const center = points.length ? [points[0].lat, points[0].lng] : [-31.4, -64.18];
      const map = L.map(ref.current, {
        zoomControl: false, dragging: false, scrollWheelZoom: false,
        doubleClickZoom: false, touchZoom: false, boxZoom: false, keyboard: false,
      }).setView(center, 9);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "", maxZoom: 19 }).addTo(map);
      mapRef.current = map;
      initializedRef.current = true;
      setMapReady(true);
    }).catch(console.error);
    return () => { cancelled = true; };
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  // Efecto 2: re-renderizar puntos (corre cuando mapa está listo O cuando puntos cambian)
  useEffect(() => {
    if (!mapReady || !mapRef.current || !window.L) return;
    const dp = placeType && points.length === 1 ? [{ ...points[0], label: placeType }] : points;
    renderMapLayers(window.L, mapRef.current, dp, segmentGeometries, segmentTypes, layersRef, true, null, null, null, null);
  }, [mapReady, points, segmentGeometries, segmentTypes, placeType]);

  // Efecto 3: capa de lugares, separada para no tocar el mapa base
  useEffect(() => {
    if (!mapReady || !mapRef.current || !window.L) return;
    const L = window.L;
    lugaresLayerRef.current.forEach(l => l.remove?.());
    lugaresLayerRef.current = [];
    lugares.forEach((lugar) => {
      if (!lugar.points?.[0]) return;
      const icon = L.divIcon({
        html: `<div style="background:#10b981;width:8px;height:8px;border-radius:50%;border:2px solid #fff;box-shadow:0 1px 4px #0009"></div>`,
        iconSize: [8, 8], iconAnchor: [4, 4], className: "",
      });
      const m = L.marker([lugar.points[0].lat, lugar.points[0].lng], { icon })
        .bindPopup(`<b>${lugar.title}</b><br/><i style="color:#94a3b8">${lugar.placeType || ""}</i>`)
        .addTo(mapRef.current);
      lugaresLayerRef.current.push(m);
    });
  }, [lugares]);

  // Cleanup al desmontar
  useEffect(() => {
    return () => {
      layersRef.current.forEach((l) => l.remove?.());
      lugaresLayerRef.current.forEach((l) => l.remove?.());
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }
      initializedRef.current = false;
      setMapReady(false);
    };
  }, []);

  return (
    <div ref={wrapperRef} style={{ minHeight: 160 }}>
      <div ref={ref} style={{ width: "100%", height: 160, borderRadius: "0 0 10px 10px", overflow: "hidden", marginTop: 10, border: "1px solid #334155", background: "#0f172a" }} />
    </div>
  );
}

// ── MapPicker ────────────────────────────────────────────────────────────────
function MapPicker({ points, onChange, readonly = false, segmentGeometries = [], segmentTypes = [], lugares = [], placeType }) {
  const ref = useRef(null);
  const mapRef = useRef(null);
  const layersRef = useRef([]);
  const lugaresLayerRef = useRef([]);
  const ptRef = useRef(points);
  ptRef.current = points;
  
  // FIX: Flag para evitar re-inicialización
  const initializedRef = useRef(false);
  const [mapReady, setMapReady] = useState(false);

  useEffect(() => {
    // FIX: Solo inicializar una vez
    if (initializedRef.current || !ref.current || mapRef.current) return;
    
    let mounted = true;
    
    const initMap = async () => {
      try {
        const L = await loadLeaflet();
        // FIX: Doble check después del await
        if (!mounted || !ref.current || mapRef.current) return;
        
        const center = points.length ? [points[0].lat, points[0].lng] : [-31.4, -64.18];
        const map = L.map(ref.current).setView(center, 9);
        mapRef.current = map;
        
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { 
          attribution: '© OSM', 
          maxZoom: 19 
        }).addTo(map);
        
        if (!readonly) {
          map.on("click", (e) => {
            const updated = normalizePoints([...ptRef.current, { lat: e.latlng.lat, lng: e.latlng.lng }]);
            onChange(updated);
          });
        }
        
        initializedRef.current = true;
        setMapReady(true);
        
        // FIX: Forzar invalidateSize después de crear
        setTimeout(() => {
          if (mapRef.current) {
            mapRef.current.invalidateSize();
          }
        }, 100);
        
      } catch (err) {
        console.error('Error initializing map:', err);
      }
    };
    
    initMap();
    
    return () => { 
      mounted = false;
    };
  }, []); // FIX: Solo al montar - sin dependencias problemáticas

  // Efecto separado para actualizar capas cuando cambian los datos
  useEffect(() => {
    if (!mapReady || !mapRef.current || !window.L) return;
    
    const displayPoints = placeType && points.length === 1
      ? [{ ...points[0], label: placeType }]
      : points;
      
    renderMapLayers(window.L, mapRef.current, displayPoints, segmentGeometries, segmentTypes, layersRef, readonly, onChange, ptRef, null, null);
    
    // FIX: invalidateSize después de renderizar capas
    setTimeout(() => {
      mapRef.current?.invalidateSize();
    }, 50);
    
  }, [mapReady, points, segmentGeometries, segmentTypes, readonly, onChange, placeType]);

  useEffect(() => {
    if (!mapReady || !mapRef.current || !window.L) return;
    const L = window.L;
    lugaresLayerRef.current.forEach(l => l.remove?.());
    lugaresLayerRef.current = [];
    lugares.forEach((lugar) => {
      if (!lugar.points?.[0]) return;
      const icon = L.divIcon({
        html: `<div style="background:#10b981;width:10px;height:10px;border-radius:50%;border:2px solid #fff;box-shadow:0 1px 4px #0009"></div>`,
        iconSize: [10, 10], iconAnchor: [5, 5], className: "",
      });
      const m = L.marker([lugar.points[0].lat, lugar.points[0].lng], { icon })
        .bindPopup(`<b>${lugar.title}</b><br/><span style="color:#64748b">${lugar.placeType || ""}</span>`)
        .addTo(mapRef.current);
      lugaresLayerRef.current.push(m);
    });
  }, [mapReady, lugares]);

  useEffect(() => {
    return () => {
      layersRef.current.forEach((l) => l.remove?.());
      lugaresLayerRef.current.forEach((l) => l.remove?.());
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }
      initializedRef.current = false;
      setMapReady(false);
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
        <div style={{ background: "#1e293b", borderRadius: 8, marginTop: 4, maxHeight: 190, overflowY: "auto" }}>
          {res.map((r, i) => (
            <div key={`${r.place_id}-${i}`} onClick={() => { onSelect(parseFloat(r.lat), parseFloat(r.lon), r.display_name); setRes([]); setQ(""); }}
              style={{ padding: "9px 12px", cursor: "pointer", fontSize: 13, color: "#cbd5e1", borderBottom: "1px solid #0f172a" }}>
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
function PostCard({ post, currentUser, onLike, onComment, goProfile, goPostId, savedRoutes, onToggleSaved, onOpenNavigatorModal, lugares = [] }) {
  const meta = TYPE_META[post.type];
  const liked = !!(currentUser && post.likes?.includes(currentUser.id));
  const [showC, setShowC] = useState(false);
  const [cText, setCText] = useState("");
  const hasMap = post.points?.length > 0 && (isRouteType(post.type) || post.type === "lugar" || post.type === "evento");
  const saved = currentUser && savedRoutes?.some((r) => r.route_id === post.id);

  const submitComment = () => {
    if (!cText.trim()) return;
    onComment(post.id, cText.trim());
    setCText("");
  };

  return (
    <div style={{ background: "#1e293b", borderRadius: 14, marginBottom: 12, overflow: "hidden" }}>
      <div style={{ padding: 16 }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 10 }}>
          <div onClick={() => goProfile(post.userId)} style={{ cursor: "pointer" }}><Avatar username={post.author?.username} /></div>
          <div style={{ flex: 1 }}>
            <span style={{ color: "#f8fafc", fontWeight: 600, cursor: "pointer" }} onClick={() => goProfile(post.userId)}>@{post.author?.username}</span>
            {post.author?.moto && <span style={{ color: "#475569", fontSize: 11, marginLeft: 8 }}>🏍️ {post.author.moto.modelo}</span>}
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
            {[...new Set(post.segments.map((s) => s.roadType))].map((rt) => <RoadTypeBadge key={rt} value={rt} />)}
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
            <button onClick={() => { playAudio(); onToggleSaved(post.id); }} style={{ background: "none", border: "none", color: saved ? "#f59e0b" : "#64748b", cursor: "pointer", fontSize: 15, padding: 0 }}>
              {saved ? "⭐ Guardada" : "⭐ Guardar"}
            </button>
          )}
          <button onClick={() => goPostId(post.id)} style={{ background: "none", border: "none", color: "#f59e0b", cursor: "pointer", fontSize: 13, padding: 0, marginLeft: "auto" }}>
            {hasMap ? "Ver ruta completa →" : "Ver detalle →"}
          </button>
        </div>

        {currentUser && isNavigableRoute(post) && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
            <button onClick={() => { playAudio(); onOpenNavigatorModal(post.id); }} style={{ ...btn, padding: "8px 12px" }}>🚀 Hacer esta ruta</button>
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
                <input value={cText} onChange={(e) => setCText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submitComment()} placeholder="Comentar…" style={{ ...inp, flex: 1, padding: "6px 10px" }} />
                <button onClick={submitComment} style={{ ...btn, padding: "6px 12px" }}>↑</button>
              </div>
            )}
          </div>
        )}
      </div>
      {hasMap && <MiniMap points={post.points} segmentGeometries={post.segmentGeometries} segmentTypes={post.segments?.map((s) => s.roadType)} lugares={lugares} placeType={post.placeType} />}
    </div>
  );
}

// ── ProfileView ──────────────────────────────────────────────────────────────
function ProfileView({ profileId, currentUser, routes, goBack, goPostId, handleLike, handleComment, savedRoutes, handleToggleSaved, setNavigatorPostId, handleLogout }) {
  const [profile, setProfile] = useState(null);
  const [userRoutes, setUserRoutes] = useState([]);
  const [followCounts, setFollowCounts] = useState({ followers: 0, following: 0 });
  const [isFollowing, setIsFollowing] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const [p, r, counts] = await Promise.all([
          fetchProfile(profileId),
          fetchUserRoutes(profileId),
          fetchFollowCounts(profileId),
        ]);
        setProfile(p);
        setUserRoutes(r.map(transformRoute));
        setFollowCounts(counts);
        if (currentUser && currentUser.id !== profileId) {
          const following = await checkIsFollowing(currentUser.id, profileId);
          setIsFollowing(following);
        }
      } catch (err) { console.error(err); }
      setLoading(false);
    };
    load();
  }, [profileId, currentUser]);

  const handleFollow = async () => {
    if (!currentUser) return;
    try {
      const nowFollowing = await toggleFollow(currentUser.id, profileId);
      setIsFollowing(nowFollowing);
      setFollowCounts(prev => ({
        ...prev,
        followers: nowFollowing ? prev.followers + 1 : prev.followers - 1
      }));
    } catch (err) { console.error(err); }
  };

  if (loading) return <LoadingSpinner />;
  if (!profile) return <p style={{ color: "#64748b" }}>Usuario no encontrado.</p>;

  const isOwn = currentUser?.id === profile.id;

  return (
    <div>
      <button onClick={goBack} style={{ ...btn2, padding: "6px 12px", marginBottom: 14 }}>← Volver</button>
      <div style={{ textAlign: "center", marginBottom: 20 }}>
        <div style={{ display: "flex", justifyContent: "center" }}><Avatar username={profile.username} size={68} /></div>
        <h2 style={{ color: "#f1f5f9", margin: "10px 0 2px" }}>@{profile.username}</h2>
        {profile.moto_modelo && (
          <p style={{ color: "#f59e0b", fontSize: 14, margin: "0 0 10px" }}>🏍️ {profile.moto_modelo} · {profile.moto_cilindrada}cc · {profile.moto_anio}</p>
        )}
        <div style={{ display: "flex", justifyContent: "center", gap: 24, color: "#64748b", fontSize: 14, marginBottom: 14 }}>
          <span><strong style={{ color: "#f1f5f9" }}>{userRoutes.length}</strong> publicaciones</span>
          <span><strong style={{ color: "#f1f5f9" }}>{followCounts.followers}</strong> seguidores</span>
          <span><strong style={{ color: "#f1f5f9" }}>{followCounts.following}</strong> siguiendo</span>
        </div>
        {!isOwn && currentUser && (
          <button onClick={handleFollow} style={{ ...(isFollowing ? btn2 : btn), padding: "8px 28px" }}>{isFollowing ? "Dejar de seguir" : "Seguir"}</button>
        )}
        {isOwn && <button onClick={handleLogout} style={{ ...btn2, padding: "8px 20px" }}>Cerrar sesión</button>}
      </div>

      <h3 style={{ color: "#94a3b8", fontSize: 14, marginBottom: 12 }}>Publicaciones de @{profile.username}</h3>
      {userRoutes.length === 0 && <p style={{ color: "#64748b" }}>Sin publicaciones aún.</p>}
      {userRoutes.map((p) => (
        <PostCard key={p.id} post={p} currentUser={currentUser} onLike={handleLike} onComment={handleComment}
          goProfile={() => {}} goPostId={goPostId} savedRoutes={savedRoutes} onToggleSaved={handleToggleSaved} onOpenNavigatorModal={setNavigatorPostId} />
      ))}
    </div>
  );
}

// ── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [currentUser, setCurrentUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [routes, setRoutes] = useState([]);
  const [savedRoutes, setSavedRoutes] = useState([]);

  // Precargar Leaflet inmediatamente para que los mapas no esperen
  useEffect(() => { loadLeaflet().catch(console.error); }, []);

  const [view, setView] = useState("feed");
  const [navStack, setNavStack] = useState([]);
  const [authMode, setAuthMode] = useState("login");
  const [authF, setAuthF] = useState({ email: "", username: "", pass: "", modelo: "", cilindrada: "", anio: "" });
  const [authErr, setAuthErr] = useState("");

  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const debouncedText = useDebouncedValue(filters.text, 250);

  const [np, setNp] = useState(EMPTY_NP);
  const [npStep, setNpStep] = useState(1);
  const routeReqIdRef = useRef(0);

  const [activePostId, setActivePostId] = useState(null);
  const [activeProfileId, setActiveProfileId] = useState(null);
  const [navigatorPostId, setNavigatorPostId] = useState(null);
  const [activeNavigation, setActiveNavigation] = useState(null);

  // ─── Auth effect ───────────────────────────────────────────────────────────
  useEffect(() => {
    const loadUserData = async (userId, email) => {
      try {
        const profile = await fetchProfile(userId);
        setCurrentUser({ id: userId, email, ...profile });
        const saved = await fetchSavedRoutes(userId);
        setSavedRoutes(saved || []);
      } catch (err) {
        console.error("Error loading user data:", err);
        setCurrentUser({ id: userId, email });
        setSavedRoutes([]);
      }
    };

    // Paso 1: verificar sesión existente al arrancar
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        loadUserData(session.user.id, session.user.email).finally(() => setAuthLoading(false));
      } else {
        setAuthLoading(false);
      }
    }).catch(() => setAuthLoading(false));

    // Paso 2: escuchar cambios POSTERIORES (login, logout, token refresh)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' && session?.user) {
        loadUserData(session.user.id, session.user.email);
      } else if (event === 'SIGNED_OUT') {
        setCurrentUser(null);
        setSavedRoutes([]);
      }
    });

    return () => subscription?.unsubscribe();
  }, []);

  // ─── Load routes ───────────────────────────────────────────────────────────
  useEffect(() => {
    const load = async () => {
      try {
        const data = await fetchRoutes();
        setRoutes(data.map(transformRoute));
      } catch (err) { console.error(err); }
    };
    load();
  }, []);

  // ─── Audio intro effect ────────────────────────────────────────────────────
  useEffect(() => {
    if (view !== "feed") return;
    if (sessionStorage.getItem("br_intro_played")) return;
    
    const tryPlay = () => {
      const audio = document.getElementById("br-audio");
      if (audio) {
        audio.volume = 0.85;
        audio.play().then(() => sessionStorage.setItem("br_intro_played", "1")).catch(() => {});
      }
    };
    
    tryPlay();
    const handler = () => { tryPlay(); window.removeEventListener("click", handler); };
    window.addEventListener("click", handler, { once: true });
    return () => window.removeEventListener("click", handler);
  }, [view]);

  // ─── Navigation helpers ────────────────────────────────────────────────────
  const openView = (nextView, payloadFn) => { setNavStack((prev) => [...prev, view]); payloadFn?.(); setView(nextView); };
  const goBack = () => { setNavStack((prev) => { const next = [...prev]; const last = next.pop(); setView(last || "feed"); return next; }); };
  const goProfile = (id) => { openView("profile", () => setActiveProfileId(id)); };
  const goPostId = (id) => { openView("post", () => setActivePostId(id)); };

  // ─── Auth handlers ─────────────────────────────────────────────────────────
  const handleAuth = async () => {
    setAuthErr("");
    if (authMode === "login") {
      try {
        await signIn(authF.email, authF.pass);
        setAuthF({ email: "", username: "", pass: "", modelo: "", cilindrada: "", anio: "" });
        setView("feed"); setNavStack([]);
      } catch (err) { setAuthErr(err.message || "Error al iniciar sesión"); }
    } else {
      if (!authF.email || !authF.username || !authF.pass || !authF.modelo || !authF.cilindrada || !authF.anio) {
        return setAuthErr("Completá todos los campos");
      }
      try {
        await signUp(authF.email, authF.pass, authF.username, { modelo: authF.modelo, cilindrada: authF.cilindrada, anio: authF.anio });
        setAuthErr("✅ Revisá tu email para confirmar la cuenta");
      } catch (err) { setAuthErr(err.message || "Error al registrar"); }
    }
  };

  const handleLogout = async () => {
    await signOut();
    setCurrentUser(null);
    setSavedRoutes([]);
    setView("feed"); setNavStack([]);
  };

  // ─── Route handlers ────────────────────────────────────────────────────────
  const handleLike = async (routeId) => {
    if (!currentUser) return;
    try {
      const liked = await toggleLike(routeId, currentUser.id);
      setRoutes(prev => prev.map(r => r.id === routeId ? { ...r, likes: liked ? [...r.likes, currentUser.id] : r.likes.filter(id => id !== currentUser.id) } : r));
    } catch (err) { console.error(err); }
  };

  const handleComment = async (routeId, text) => {
    if (!currentUser) return;
    try {
      const comment = await addComment(routeId, currentUser.id, text);
      setRoutes(prev => prev.map(r => r.id === routeId ? {
        ...r,
        comments: [...r.comments, { id: comment.id, odId: currentUser.id, text, createdAt: Date.now(), username: currentUser.username }]
      } : r));
    } catch (err) { console.error(err); }
  };

  const handleToggleSaved = async (routeId) => {
    if (!currentUser) return;
    try {
      await toggleSaveRoute(currentUser.id, routeId);
      const saved = await fetchSavedRoutes(currentUser.id);
      setSavedRoutes(saved);
    } catch (err) { console.error(err); }
  };

  const handleMarkCompleted = async (saved) => {
    if (!currentUser) return;
    try {
      await updateSavedRouteStatus(currentUser.id, saved.route_id, "completed");
      const updated = await fetchSavedRoutes(currentUser.id);
      setSavedRoutes(updated);
    } catch (err) { console.error(err); }
  };

  // ─── Navigation handlers ───────────────────────────────────────────────────
  const startNavigation = (saved, post) => {
    setActiveNavigation({ savedRouteId: saved.id, postId: post.id, post });
    setNavigatorPostId(null);
  };

  const startNavigationForPost = (postId) => {
    const post = routes.find(r => r.id === postId);
    if (!post) return;
    setActiveNavigation({ postId: post.id, post });
    setNavigatorPostId(null);
  };

  const completeNavigation = async (trackPoints, trackedKm) => {
    if (!currentUser || !activeNavigation) return;
    // Mark as completed and optionally save track data
    try {
      const savedRoute = savedRoutes.find(s => s.route_id === activeNavigation.postId);
      if (savedRoute) {
        await updateSavedRouteStatus(currentUser.id, activeNavigation.postId, "completed");
        const updated = await fetchSavedRoutes(currentUser.id);
        setSavedRoutes(updated);
      }
      // TODO: Save trackPoints to a new table for verified routes
      console.log("Track completed:", { trackPoints: trackPoints.length, trackedKm });
    } catch (err) { console.error(err); }
    setActiveNavigation(null);
  };

  // ─── Create route handlers ─────────────────────────────────────────────────
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
      const geometries = [], kms = [];
      for (let i = 0; i < np.points.length - 1; i++) {
        const result = await fetchSegmentRoute(np.points[i], np.points[i + 1]);
        if (reqId !== routeReqIdRef.current) return;
        geometries.push(result.geometry);
        kms.push(result.km);
      }

      const provinceResults = await Promise.all(np.points.map(fetchProvince));
      if (reqId !== routeReqIdRef.current) return;

      setNp((prev) => ({
        ...prev,
        segmentGeometries: geometries,
        segmentKm: kms,
        totalKm: Math.round(kms.reduce((a, b) => a + b, 0) * 10) / 10,
        provinces: [...new Set(provinceResults.filter(Boolean))],
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
      const newRoute = await createRoute({
        user_id: currentUser.id,
        type: np.type,
        title: np.title,
        description: np.desc,
        tags: np.tags,
        points: np.type === "lugar" && np.points.length === 1
          ? [{ ...np.points[0], label: np.placeType || "Lugar" }]
          : np.points,
        segments: np.segments,
        segment_geometries: np.segmentGeometries,
        segment_km: np.segmentKm,
        total_km: np.totalKm,
        provinces: np.provinces,
        place_type: np.type === "lugar" ? np.placeType : null,
        event_date: np.type === "evento" ? np.eventDate : null,
      });
      setRoutes(prev => [transformRoute({ ...newRoute, profiles: currentUser, route_likes: [], route_comments: [] }), ...prev]);
      setNp(EMPTY_NP);
      setNpStep(1);
      setView("feed"); setNavStack([]);
    } catch (err) { console.error(err); }
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
  const allLugares = useMemo(() => routes.filter((p) => p.type === "lugar" && p.points?.length > 0), [routes]);

  const navigatorPost = navigatorPostId ? routes.find((p) => p.id === navigatorPostId) : null;
  const draftIsRoute = isRouteType(np.type);
  const routeComputed = np.segmentGeometries.length > 0;
  const canPublish = !!np.title.trim() && np.points.length > 0 && !(np.type === "lugar" && !np.placeType) && !(np.type === "lugar" && np.points.length !== 1) && !(np.type === "evento" && !np.eventDate) && !(draftIsRoute && np.points.length >= 2 && !routeComputed);
  const inNav = !["auth", "new", "post", "profile"].includes(view);

  if (authLoading) {
    return <div style={{ background: "#0f172a", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}><LoadingSpinner /></div>;
  }

  return (
    <div style={{ background: "#0f172a", minHeight: "100vh", color: "#f1f5f9", fontFamily: "system-ui,sans-serif", maxWidth: 480, margin: "0 auto" }}>
      {/* Audio element */}
      <audio id="br-audio" src={AUDIO_SRC} preload="auto" />

      {/* Header */}
      <div style={{ background: "#1e293b", padding: "8px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, zIndex: 100, borderBottom: "1px solid #334155" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <img src="/icon-192.png" alt="BuenaRuta" style={{ height: 96, cursor: "pointer" }} onClick={() => { setView("feed"); setNavStack([]); }} />
          <button onClick={playAudio} style={{ ...btn2, padding: "4px 8px", fontSize: 16 }} title="Escuchar intro">🎵</button>
        </div>
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

            {authErr && <p style={{ color: authErr.includes("✅") ? "#22c55e" : "#ef4444", fontSize: 13, marginBottom: 8 }}>{authErr}</p>}

            <button onClick={handleAuth} style={{ ...btn, width: "100%", padding: 12 }}>{authMode === "login" ? "Entrar" : "Registrarme"}</button>

            <p style={{ color: "#64748b", textAlign: "center", marginTop: 14, fontSize: 14 }}>
              {authMode === "login" ? "¿No tenés cuenta? " : "¿Ya tenés cuenta? "}
              <span style={{ color: "#f59e0b", cursor: "pointer" }} onClick={() => setAuthMode(authMode === "login" ? "register" : "login")}>
                {authMode === "login" ? "Registrate" : "Iniciá sesión"}
              </span>
            </p>
          </div>
        )}

        {/* Feed View */}
        {view === "feed" && (
          <div>
            {/* Saved Routes Panel */}
            <SavedRoutesPanel savedRoutes={savedRoutes} routes={routes} currentUser={currentUser}
              onOpenPost={goPostId} onStartNavigation={startNavigation} onToggleSaved={handleToggleSaved} onMarkCompleted={handleMarkCompleted} onOpenNavigatorModal={setNavigatorPostId} />

            {/* Quick Filters */}
            <div style={{ background: "#1e293b", borderRadius: 14, padding: 12, marginBottom: 16, border: "1px solid #334155" }}>
              <input placeholder="Buscar ruta..." style={{ ...inp, marginBottom: 10 }} value={filters.text} onChange={(e) => setFilters((prev) => ({ ...prev, text: e.target.value }))} />
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
                {[{ value: "likes", label: "Más likes" }, { value: "recent", label: "Recientes" }, { value: "km", label: "Más km" }].map((opt) => (
                  <button key={opt.value} onClick={() => setFilters((prev) => ({ ...prev, sortBy: opt.value }))} style={{
                    ...btn2, padding: "6px 12px", borderRadius: 99,
                    background: filters.sortBy === opt.value ? "#f59e0b" : "#0f172a",
                    color: filters.sortBy === opt.value ? "#0f172a" : "#94a3b8",
                  }}>{opt.label}</button>
                ))}
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <button onClick={() => setFilters((prev) => ({ ...prev, province: "" }))} style={{
                  ...btn2, padding: "6px 12px", borderRadius: 99,
                  background: !filters.province ? "#f59e0b22" : "#0f172a",
                  color: !filters.province ? "#f59e0b" : "#94a3b8",
                }}>Todas</button>
                {allProvinces.map((p) => (
                  <button key={p} onClick={() => setFilters((prev) => ({ ...prev, province: prev.province === p ? "" : p }))} style={{
                    ...btn2, padding: "6px 12px", borderRadius: 99,
                    background: filters.province === p ? "#f59e0b22" : "#0f172a",
                    color: filters.province === p ? "#f59e0b" : "#94a3b8",
                  }}>{p}</button>
                ))}
              </div>
            </div>

            {/* Route List */}
            {filteredRoutes.length === 0 && <p style={{ color: "#64748b", textAlign: "center", marginTop: 30 }}>Sin resultados.</p>}
            {filteredRoutes.map((p) => (
              <PostCard key={p.id} post={p} currentUser={currentUser} onLike={handleLike} onComment={handleComment}
                goProfile={goProfile} goPostId={goPostId} savedRoutes={savedRoutes} onToggleSaved={handleToggleSaved} onOpenNavigatorModal={setNavigatorPostId} lugares={allLugares} />
            ))}
          </div>
        )}

        {/* Explore View */}
        {view === "explore" && (
          <div>
            <div style={{ background: "#1e293b", borderRadius: 12, padding: 12, marginBottom: 14 }}>
              <p style={{ color: "#94a3b8", margin: "0 0 10px", fontSize: 13 }}>Filtrar publicaciones</p>
              <input placeholder="🔍 Buscar..." style={{ ...inp, marginBottom: 10 }} value={filters.text} onChange={(e) => setFilters((prev) => ({ ...prev, text: e.target.value }))} />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 10 }}>
                <select style={inp} value={filters.type} onChange={(e) => setFilters((prev) => ({ ...prev, type: e.target.value }))}>
                  <option value="all">Todos los tipos</option>
                  <option value="ruta">🛣️ Ruta</option>
                  <option value="viaje">🧳 Viaje</option>
                  <option value="lugar">📍 Lugar</option>
                  <option value="evento">🎉 Evento</option>
                </select>
                <select style={inp} value={filters.province} onChange={(e) => setFilters((prev) => ({ ...prev, province: e.target.value }))}>
                  <option value="">Todas las provincias</option>
                  {allProvinces.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <select style={{ ...inp, marginBottom: 10 }} value={filters.sortBy} onChange={(e) => setFilters((prev) => ({ ...prev, sortBy: e.target.value }))}>
                <option value="likes">Ordenar por: más likes</option>
                <option value="recent">Ordenar por: más recientes</option>
                <option value="km">Ordenar por: más km</option>
              </select>
              {allTags.length > 0 && (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
                  {allTags.map((t) => (
                    <span key={t} onClick={() => setFilters((prev) => ({ ...prev, tag: prev.tag === t ? "" : t }))} style={{
                      background: filters.tag === t ? "#f59e0b22" : "#0f172a",
                      color: filters.tag === t ? "#f59e0b" : "#64748b",
                      borderRadius: 99, padding: "3px 10px", fontSize: 12, cursor: "pointer",
                      border: `1px solid ${filters.tag === t ? "#f59e0b" : "#334155"}`,
                    }}>#{t}</span>
                  ))}
                </div>
              )}
              <button onClick={() => setFilters(EMPTY_FILTERS)} style={{ ...btn2, width: "100%", padding: 10 }}>Limpiar filtros</button>
            </div>

            {filteredRoutes.length === 0 && <p style={{ color: "#64748b", textAlign: "center", marginTop: 30 }}>Sin resultados.</p>}
            {filteredRoutes.map((p) => (
              <PostCard key={p.id} post={p} currentUser={currentUser} onLike={handleLike} onComment={handleComment}
                goProfile={goProfile} goPostId={goPostId} savedRoutes={savedRoutes} onToggleSaved={handleToggleSaved} onOpenNavigatorModal={setNavigatorPostId} lugares={allLugares} />
            ))}
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
                    <button key={k} onClick={() => setNp((prev) => ({ ...prev, type: k }))} style={{
                      background: np.type === k ? v.color + "22" : "#1e293b",
                      border: `2px solid ${np.type === k ? v.color : "#334155"}`,
                      borderRadius: 10, padding: 14, cursor: "pointer",
                      color: np.type === k ? v.color : "#94a3b8", fontWeight: 600, fontSize: 15,
                    }}>{v.icon} {v.label}</button>
                  ))}
                </div>

                <input placeholder="Título *" style={{ ...inp, marginBottom: 10 }} value={np.title} onChange={(e) => setNp((prev) => ({ ...prev, title: e.target.value }))} />
                <textarea placeholder="Descripción" style={{ ...inp, marginBottom: 10, minHeight: 76, resize: "vertical" }} value={np.desc} onChange={(e) => setNp((prev) => ({ ...prev, desc: e.target.value }))} />

                {np.type === "lugar" && (
                  <select style={{ ...inp, marginBottom: 10 }} value={np.placeType} onChange={(e) => setNp((prev) => ({ ...prev, placeType: e.target.value }))}>
                    <option value="">Tipo de lugar *</option>
                    {PLACE_TYPES.map((t) => <option key={t}>{t}</option>)}
                  </select>
                )}
                {np.type === "evento" && (
                  <input type="date" style={{ ...inp, marginBottom: 10 }} value={np.eventDate} onChange={(e) => setNp((prev) => ({ ...prev, eventDate: e.target.value }))} />
                )}

                <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
                  <input placeholder="Etiqueta + Enter" style={{ ...inp, flex: 1 }} value={np.tagInput}
                    onChange={(e) => setNp((prev) => ({ ...prev, tagInput: e.target.value }))}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        const tag = np.tagInput.trim().toLowerCase();
                        if (tag && !np.tags.includes(tag)) setNp((prev) => ({ ...prev, tags: [...prev.tags, tag], tagInput: "" }));
                        else setNp((prev) => ({ ...prev, tagInput: "" }));
                      }
                    }} />
                  <button onClick={() => {
                    const tag = np.tagInput.trim().toLowerCase();
                    if (tag && !np.tags.includes(tag)) setNp((prev) => ({ ...prev, tags: [...prev.tags, tag], tagInput: "" }));
                    else setNp((prev) => ({ ...prev, tagInput: "" }));
                  }} style={{ ...btn2, padding: "8px 12px" }}>+</button>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 16 }}>
                  {np.tags.map((t) => <Badge key={t} tag={t} onRemove={() => setNp((prev) => ({ ...prev, tags: prev.tags.filter((x) => x !== t) }))} />)}
                </div>

                <button onClick={() => setNpStep(2)} disabled={!np.title.trim()} style={{ ...btn, width: "100%", padding: 12, opacity: !np.title.trim() ? 0.5 : 1 }}>
                  Siguiente: Mapa →
                </button>
              </>
            )}

            {npStep === 2 && (
              <>
                <LocationSearch onSelect={(lat, lng) => {
                  if (np.type === "lugar") {
                    updatePoints(normalizePoints([{ lat, lng }]));
                  } else {
                    updatePoints(normalizePoints([...np.points, { lat, lng }]));
                  }
                }} />
                <p style={{ color: "#64748b", fontSize: 12, marginBottom: 6 }}>
                  {np.type === "lugar"
                    ? "Tocá el mapa para marcar la ubicación exacta (1 solo punto)"
                    : "Tocá el mapa para agregar puntos · Clic derecho para eliminar"}
                </p>
                <MapPicker points={np.points} onChange={(pts) => {
                  if (np.type === "lugar" && pts.length > 1) {
                    updatePoints([pts[pts.length - 1]]);
                  } else {
                    updatePoints(pts);
                  }
                }} readonly={false} segmentGeometries={np.segmentGeometries} segmentTypes={np.segments.map((s) => s.roadType)} />

                {draftIsRoute && <SegmentEditor points={np.points} segments={np.segments} onChange={(segs) => setNp((prev) => resetRouteDerived({ ...prev, segments: segs }))} />}

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
                      {i === 0 ? "🟢" : i === np.points.length - 1 && np.points.length > 1 ? "🔴" : "🟡"} {p.label}
                    </span>
                  ))}
                </div>

                {np.points.length > 0 && (
                  <button onClick={() => setNp((prev) => resetRouteDerived({ ...prev, points: [], segments: [] }))} style={{ ...btn2, marginTop: 8, padding: "6px 12px", fontSize: 12 }}>
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
          const post = routes.find((p) => p.id === activePostId);
          if (!post) return <p style={{ color: "#64748b" }}>Publicación no encontrada.</p>;
          const meta = TYPE_META[post.type];
          const saved = currentUser && savedRoutes?.some((r) => r.route_id === post.id);

          return (
            <>
              <button onClick={goBack} style={{ ...btn2, padding: "6px 12px", marginBottom: 14 }}>← Volver</button>

              <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 12 }}>
                <div onClick={() => goProfile(post.userId)} style={{ cursor: "pointer" }}><Avatar username={post.author?.username} size={42} /></div>
                <div>
                  <span style={{ color: "#f8fafc", fontWeight: 700, cursor: "pointer" }} onClick={() => goProfile(post.userId)}>@{post.author?.username}</span>
                  {post.author?.moto && <p style={{ color: "#f59e0b", fontSize: 12, margin: "2px 0 0" }}>🏍️ {post.author.moto.modelo} · {post.author.moto.cilindrada}cc · {post.author.moto.anio}</p>}
                  <div style={{ color: meta.color, fontSize: 13, marginTop: 2 }}>{meta.icon} {meta.label}{post.placeType ? ` · ${post.placeType}` : ""}{post.eventDate ? ` · 📅 ${post.eventDate}` : ""}</div>
                </div>
              </div>

              <h2 style={{ color: "#f1f5f9", marginBottom: 6 }}>{post.title}</h2>
              <p style={{ color: "#94a3b8", marginBottom: 12, lineHeight: 1.6 }}>{post.desc}</p>

              <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 12 }}>
                {(post.tags || []).map((t) => <Badge key={t} tag={t} />)}
              </div>

              {isRouteType(post.type) && post.totalKm > 0 && <RouteSummary totalKm={post.totalKm} provinces={post.provinces} segments={post.segments} segmentKm={post.segmentKm} />}

              {currentUser && isNavigableRoute(post) && (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 16 }}>
                  <button onClick={() => { playAudio(); handleToggleSaved(post.id); }} style={{ ...btn, padding: "10px 14px" }}>{saved ? "⭐ Guardada" : "⭐ Guardar ruta"}</button>
                  <button onClick={() => { playAudio(); setNavigatorPostId(post.id); }} style={{ ...btn2, padding: "10px 14px" }}>🚀 Hacer esta ruta</button>
                </div>
              )}

              <div style={{ marginTop: 12 }}>
                <MapPicker points={post.points} onChange={() => {}} readonly segmentGeometries={post.segmentGeometries} segmentTypes={post.segments?.map((s) => s.roadType)} lugares={allLugares} placeType={post.placeType} />
              </div>

              {post.points?.length > 0 && (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
                  {post.points.map((p, i) => (
                    <span key={i} style={{ background: "#0f172a", color: "#94a3b8", borderRadius: 99, padding: "4px 12px", fontSize: 12 }}>
                      {i === 0 ? "🟢" : i === post.points.length - 1 && post.points.length > 1 ? "🔴" : "🟡"} {p.label}
                      {post.segmentKm?.[i] !== undefined && i < post.points.length - 1 ? ` · ${Math.round(post.segmentKm[i])}km →` : ""}
                    </span>
                  ))}
                </div>
              )}

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
                    <input id="comment-detail" placeholder="Escribí un comentario..." style={{ ...inp, flex: 1 }}
                      onKeyDown={(e) => { if (e.key === "Enter" && e.target.value.trim()) { handleComment(post.id, e.target.value.trim()); e.target.value = ""; } }} />
                    <button onClick={() => {
                      const input = document.getElementById("comment-detail");
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
          <ProfileView profileId={activeProfileId} currentUser={currentUser} routes={routes}
            goBack={goBack} goPostId={goPostId} handleLike={handleLike} handleComment={handleComment}
            savedRoutes={savedRoutes} handleToggleSaved={handleToggleSaved} setNavigatorPostId={setNavigatorPostId} handleLogout={handleLogout} />
        )}
      </div>

      {/* Navigator Modal */}
      {navigatorPost && (
        <NavigatorChooserModal post={navigatorPost} onClose={() => setNavigatorPostId(null)}
          onChooseApp={(app) => { openExternalNavigator(navigatorPost, app); setNavigatorPostId(null); }}
          onStartInternal={() => startNavigationForPost(navigatorPost.id)} />
      )}

      {/* Active Navigation */}
      {activeNavigation && activeNavigation.post && (
        <ActiveNavigation post={activeNavigation.post} onClose={() => setActiveNavigation(null)} onComplete={completeNavigation} />
      )}
    </div>
  );
}

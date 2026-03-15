# 🏍️ BuenaRuta

**Red social de rutas de moto para Argentina y Latinoamérica.**

Compartí rutas reales, descubrí caminos nuevos, y salí a rodar con info que importa: tipo de camino, kilómetros, provincias.

🔗 **Demo en vivo:** [buenaruta.vercel.app](https://buenaruta.vercel.app)

---

## ✨ Features

### Feed Social
- Feed compartido con rutas de toda la comunidad
- Likes, comentarios y sistema de follows
- Perfiles de usuario con datos de la moto
- Ordenamiento por likes, km o más recientes

### Rutas
- Crear rutas con puntos en el mapa (Leaflet + OpenStreetMap)
- **Tipo de camino por tramo:** asfalto, ripio, tierra, mal estado, mixto
- Cálculo automático de ruta por calles (OSRM)
- Detección automática de provincias (Nominatim)
- Búsqueda de lugares por nombre

### Navegación
- Guardar rutas para después ⭐
- Navegación GPS interna con tracking en tiempo real
- Abrir ruta en Google Maps o Waze
- Marcar rutas como completadas

### PWA
- Instalable como app nativa
- Funciona en móvil y desktop

---

## 🛠️ Stack Técnico

| Capa | Tecnología |
|------|------------|
| Frontend | React 18 + Vite |
| Backend/DB | Supabase (PostgreSQL + Auth + Realtime) |
| Mapas | Leaflet + OpenStreetMap |
| Routing | OSRM (Open Source Routing Machine) |
| Geocoding | Nominatim |
| Deploy | Vercel |
| PWA | Service Worker + manifest.json |

---

## 📁 Estructura del Proyecto

```
buenaruta/
├── index.html              # Entry point + PWA config
├── vite.config.js          # Vite configuration
├── package.json
├── vercel.json             # Vercel routing config
│
├── public/
│   ├── icon-192.png        # PWA icon
│   ├── icon-512.png        # PWA icon large
│   ├── favicon.svg
│   ├── buena-ruta.mp3      # Audio intro
│   ├── manifest.json       # PWA manifest
│   └── sw.js               # Service Worker
│
└── src/
    ├── main.jsx            # React entry point
    ├── index.css           # Global styles
    ├── App.jsx             # Main application (~1500 líneas)
    └── lib/
        └── supabase.js     # Supabase client + helpers
```

---

## 🚀 Setup Local

### 1. Clonar el repo

```bash
git clone https://github.com/fabriciopetiso/buenaruta.git
cd buenaruta
npm install
```

### 2. Configurar variables de entorno

Crear archivo `.env.local`:

```env
VITE_SUPABASE_URL=tu_supabase_url
VITE_SUPABASE_ANON_KEY=tu_supabase_anon_key
```

### 3. Configurar Supabase

Crear proyecto en [supabase.com](https://supabase.com) y ejecutar el schema SQL (ver sección abajo).

### 4. Correr en desarrollo

```bash
npm run dev
```

Abrir http://localhost:5173

---

## 🗄️ Schema de Base de Datos (Supabase)

```sql
-- Profiles (se crea automáticamente con trigger on auth.users)
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username TEXT UNIQUE,
  moto_modelo TEXT,
  moto_cilindrada TEXT,
  moto_anio TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Routes
CREATE TABLE routes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  type TEXT CHECK (type IN ('ruta', 'viaje', 'lugar', 'evento')),
  title TEXT NOT NULL,
  description TEXT,
  tags TEXT[],
  points JSONB,
  segments JSONB,
  segment_geometries JSONB,
  segment_km NUMERIC[],
  total_km NUMERIC,
  provinces TEXT[],
  place_type TEXT,
  event_date DATE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Likes
CREATE TABLE route_likes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  route_id UUID REFERENCES routes(id) ON DELETE CASCADE,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(route_id, user_id)
);

-- Comments
CREATE TABLE route_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  route_id UUID REFERENCES routes(id) ON DELETE CASCADE,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Follows
CREATE TABLE follows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  follower_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  following_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(follower_id, following_id)
);

-- Saved routes
CREATE TABLE saved_routes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  route_id UUID REFERENCES routes(id) ON DELETE CASCADE,
  status TEXT DEFAULT 'saved' CHECK (status IN ('saved', 'active', 'completed')),
  saved_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  UNIQUE(user_id, route_id)
);

-- Trigger para crear profile automáticamente
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, username)
  VALUES (NEW.id, NEW.raw_user_meta_data->>'username');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- RLS (Row Level Security)
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE routes ENABLE ROW LEVEL SECURITY;
ALTER TABLE route_likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE route_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE follows ENABLE ROW LEVEL SECURITY;
ALTER TABLE saved_routes ENABLE ROW LEVEL SECURITY;

-- Políticas básicas (leer público, escribir autenticado)
CREATE POLICY "Public read" ON profiles FOR SELECT USING (true);
CREATE POLICY "Own update" ON profiles FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Public read" ON routes FOR SELECT USING (true);
CREATE POLICY "Auth insert" ON routes FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Own delete" ON routes FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "Public read" ON route_likes FOR SELECT USING (true);
CREATE POLICY "Auth insert" ON route_likes FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Own delete" ON route_likes FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "Public read" ON route_comments FOR SELECT USING (true);
CREATE POLICY "Auth insert" ON route_comments FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Public read" ON follows FOR SELECT USING (true);
CREATE POLICY "Auth insert" ON follows FOR INSERT WITH CHECK (auth.uid() = follower_id);
CREATE POLICY "Own delete" ON follows FOR DELETE USING (auth.uid() = follower_id);

CREATE POLICY "Own read" ON saved_routes FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Own insert" ON saved_routes FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Own update" ON saved_routes FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Own delete" ON saved_routes FOR DELETE USING (auth.uid() = user_id);
```

---

## 🔧 Variables de Entorno

| Variable | Descripción |
|----------|-------------|
| `VITE_SUPABASE_URL` | URL del proyecto Supabase |
| `VITE_SUPABASE_ANON_KEY` | Clave pública (anon) de Supabase |

En Vercel, configurar en Settings → Environment Variables.

---

## 📱 PWA

La app es instalable como PWA:

- **Android Chrome:** Menú → "Agregar a pantalla de inicio"
- **iPhone Safari:** Compartir → "Agregar a inicio"

Archivos clave:
- `public/manifest.json` - Configuración PWA
- `public/sw.js` - Service Worker para cache
- `public/icon-192.png` / `icon-512.png` - Íconos de la app

---

## 🗺️ Roadmap

### ✅ Completado

**Core social**
- [x] Feed social con Supabase (rutas, viajes, lugares, eventos)
- [x] Auth completo (registro, login, sesiones persistentes, perfiles)
- [x] Likes, comentarios, follows entre usuarios
- [x] Guardar rutas y marcar como completadas
- [x] Filtros del feed (tipo, provincia, km, likes, texto)
- [x] PWA instalable (Android / iOS sin App Store)
- [x] Audio intro 🎵

**Mapas y rutas**
- [x] Editor de rutas con mapa interactivo (Leaflet + OSM)
- [x] Tipo de camino por tramo (asfalto / ripio / tierra / mal estado / mixto)
- [x] Cálculo automático de ruta por calles (OSRM)
- [x] Detección automática de provincias (Nominatim)
- [x] MiniMap en el feed + mapa completo en detalle de ruta
- [x] Abrir ruta en Google Maps / Waze / app del teléfono
- [x] Navegación GPS interna con tracking en tiempo real
- [x] Botón "Usar mi ubicación actual" al crear publicación

**Red de lugares (Fase 1 completa)**
- [x] Lugares de la comunidad visibles como overlay en todos los mapas
- [x] Etiqueta visible en cada punto del mapa (nombre + tipo)
- [x] Click en lugar → popup con nombre, descripción y botón "Agregar como parada"
- [x] Paradas editables al crear una ruta (nombre + descripción por punto)
- [x] Paradas se guardan como lugares persistentes (solo si tienen nombre)
- [x] Deduplicación por proximidad (~30m) — no crea duplicados
- [x] Paradas ocultas del feed social (son overlay de mapa, no posts)

**Gestión de publicaciones (Fase 2 completa)**
- [x] Guardar borrador — publicar sin que aparezca en el feed
- [x] Continuar editando un borrador guardado
- [x] Editar una ruta publicada (✏️ Editar — solo para el creador)
- [x] Eliminar una publicación propia (🗑 Eliminar — solo para el creador)

### 🔜 Próximos pasos — Fase 0 pendiente (usabilidad)

- [ ] **Onboarding básico** — pantalla de bienvenida o tooltips para usuario nuevo
- [ ] **Botón Seguir en el feed** — sin tener que entrar al perfil
- [ ] **Buscador de usuarios** — buscar por @username o nombre

### 📸 Fase 3 — Calidad en campo

- [ ] **Fotos en publicaciones** — hasta 5 imágenes por ruta o lugar (Supabase Storage)
- [ ] **Exportar ruta como GPX**
- [ ] **Guardar track GPS recorrido** en Supabase

### 🔐 Fase 4 — Administración

- [ ] **Roles (superadmin)** — Custom Claims en Supabase JWT
- [ ] **Panel de moderación** — editar/eliminar contenido, log de acciones
- [ ] **Notificaciones** — likes, comentarios, nuevas rutas de seguidos (Push PWA)

### 💡 Ideas futuras

- [ ] Modo offline con rutas descargadas
- [ ] Gamification (badges, km totales, rutas completadas)
- [ ] Integración con apps de telemetría
- [ ] Datos anonimizados para turismo regional / aseguradoras (requiere volumen)

---

## 🚀 Cómo funciona BuenaRuta

### Para el usuario nuevo

**1. Registrarse**
Creás una cuenta con email, elegís un @usuario y cargás los datos de tu moto. El perfil con la moto es parte de la identidad — es lo que aparece en tus publicaciones.

**2. Explorar el feed**
En el Home vas a ver rutas, viajes, lugares y eventos publicados por la comunidad. Cada card muestra el mapa de la ruta, los km, el tipo de camino y la provincia. Podés filtrar por tipo, provincia, km o likes.

**3. Interactuar**
Podés dar like, comentar y guardar rutas para hacerlas después. Si seguís a alguien, sus publicaciones aparecen primero.

**4. Crear una publicación**
Tocás **+ Publicar** y elegís qué querés publicar:
- 🛣️ **Ruta** — trayecto con inicio, paradas y fin
- 🧳 **Viaje** — igual que ruta, para travesías largas
- 📍 **Lugar** — un punto de interés: mecánico, nafta, bar, mirador, camping
- 🎉 **Evento** — concentración, salida grupal, fecha específica

**5. Armar la ruta en el mapa**
En el paso 2 marcás los puntos tocando el mapa, buscando por nombre o usando tu ubicación actual. Si es una ruta, calculás el trazado por calles (OSRM) y elegís el tipo de camino por tramo. Para cada parada podés cargar un nombre y descripción — esa info queda guardada como punto de interés para toda la comunidad.

**6. Publicar o guardar borrador**
- **Publicar** → aparece en el feed de todos
- **Borrador** → se guarda solo para vos, podés seguir editándolo cuando quieras

**7. Hacer una ruta**
Desde cualquier ruta podés abrirla en Google Maps, Waze o la app de navegación del teléfono. También hay navegación GPS interna con tracking en tiempo real.

### Los lugares de la comunidad
Cada vez que alguien publica un lugar o carga paradas en una ruta, esos puntos aparecen como markers verdes en **todos los mapas de la app**. Al tocarlos ves el nombre, tipo y descripción. Si estás armando una ruta podés tocar cualquier marker verde y agregarlo como parada con un botón.

---

## 🤝 Contribuir

1. Fork del repo
2. Crear branch (`git checkout -b feature/nueva-feature`)
3. Commit (`git commit -m 'Add nueva feature'`)
4. Push (`git push origin feature/nueva-feature`)
5. Abrir Pull Request

---

## 📝 Notas Técnicas

### Sobre App.jsx
El archivo principal (`src/App.jsx`) concentra la mayoría de la lógica (~2000 líneas). Esto es intencional para esta fase del proyecto, priorizando velocidad de iteración sobre modularidad.

**Incluye:**
- Loader de Leaflet (carga dinámica)
- Constantes y helpers
- Hooks personalizados
- Componentes UI (Avatar, Badge, MiniMap, MapPicker, etc.)
- Lógica de navegación GPS
- Integración con Supabase

**Refactor pendiente:** Separar en módulos cuando el proyecto escale.

### Schema — columnas adicionales requeridas
```sql
-- Agregada en Marzo 2026
ALTER TABLE routes ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'published';
```

### APIs externas usadas
- **OSRM** (router.project-osrm.org) - Cálculo de rutas
- **Nominatim** (nominatim.openstreetmap.org) - Geocoding reverso
- **OpenStreetMap** - Tiles del mapa

---

## 📄 Licencia

MIT

---

## 👤 Autor

**Fabricio Petiso**
- GitHub: [@fabriciopetiso](https://github.com/fabriciopetiso)

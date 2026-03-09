# 🏍️ BuenaRuta

Red social para compartir rutas de moto en Argentina.

## Características

- 📍 Crear rutas con múltiples puntos y tipos de camino
- 🗺️ Visualización en mapa con Leaflet + OpenStreetMap
- 🔗 **Compartir rutas por link** (sin backend!)
- 🧭 Navegación integrada o abrir en Google Maps/Waze
- ⭐ Guardar rutas favoritas
- 👥 Sistema social: likes, comentarios, seguir usuarios

## Stack

- React 18 + Vite
- Leaflet para mapas
- OSRM para cálculo de rutas
- localStorage para persistencia (MVP)

## Desarrollo local

```bash
npm install
npm run dev
```

## Deploy

El proyecto está configurado para deploy automático en Vercel:

```bash
npm run build
```

## Compartir rutas

Las rutas se comparten codificando los datos en Base64 en la URL:

```
https://buenaruta.vercel.app/r/eyJ0IjoiQWx0YXMgQ3VtYnJlcyIsLi4ufQ==
```

Cuando alguien abre el link:
1. Se decodifica la ruta
2. Se guarda en su localStorage
3. Se redirige a la app

## Métricas

El sistema trackea localmente:
- `br_metrics.shareAttempts` - Intentos de compartir
- `br_metrics.sharedLoads` - Rutas cargadas desde links compartidos

## Roadmap

- [ ] PWA para instalación en móvil
- [ ] Export a GPX
- [ ] Backend con Supabase (cuando haya tracción)
- [ ] Cache de geometrías OSRM

## Licencia

MIT

import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';

// Decodificar ruta desde Base64
const decodeRoute = (encoded) => {
  try {
    const json = atob(encoded);
    const data = JSON.parse(json);
    return {
      id: `shared_${Date.now()}`,
      type: data.type || 'ruta',
      title: data.t || 'Ruta compartida',
      desc: data.d || '',
      tags: data.tags || [],
      points: (data.p || []).map((p, i, arr) => ({
        lat: p[0],
        lng: p[1],
        label: i === 0 ? 'Inicio' : i === arr.length - 1 ? 'Fin' : `Parada ${i}`
      })),
      segments: (data.s || []).map(roadType => ({ roadType })),
      segmentGeometries: data.g || [],
      segmentKm: data.km || [],
      totalKm: data.totalKm || 0,
      provinces: data.prov || [],
      userId: 'shared',
      likes: [],
      comments: [],
      createdAt: Date.now(),
      isShared: true
    };
  } catch (e) {
    console.error('Error decoding route:', e);
    return null;
  }
};

// Guardar en localStorage para que la App principal la vea
const saveSharedRoute = (route) => {
  try {
    const existing = JSON.parse(localStorage.getItem('br_posts') || '[]');
    
    // Evitar duplicados por título
    const isDupe = existing.some(p => 
      p.title === route.title && 
      p.points?.length === route.points?.length
    );
    
    if (!isDupe) {
      localStorage.setItem('br_posts', JSON.stringify([route, ...existing]));
    }
    
    // Marcar que venimos de un share para métricas
    const metrics = JSON.parse(localStorage.getItem('br_metrics') || '{}');
    metrics.sharedLoads = (metrics.sharedLoads || 0) + 1;
    metrics.lastSharedAt = Date.now();
    localStorage.setItem('br_metrics', JSON.stringify(metrics));
    
    return true;
  } catch (e) {
    console.error('Error saving shared route:', e);
    return false;
  }
};

export default function SharedRoute() {
  const { encoded } = useParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState('loading');
  const [route, setRoute] = useState(null);

  useEffect(() => {
    if (!encoded) {
      setStatus('error');
      return;
    }

    const decoded = decodeRoute(encoded);
    
    if (!decoded) {
      setStatus('error');
      return;
    }

    setRoute(decoded);
    const saved = saveSharedRoute(decoded);
    setStatus(saved ? 'success' : 'error');

    // Redirigir a la app después de 2 segundos
    const timer = setTimeout(() => {
      navigate('/', { replace: true });
    }, 2500);

    return () => clearTimeout(timer);
  }, [encoded, navigate]);

  const styles = {
    container: {
      minHeight: '100vh',
      background: '#0f172a',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
      color: '#f1f5f9',
      fontFamily: 'system-ui, sans-serif',
      textAlign: 'center'
    },
    icon: {
      fontSize: 64,
      marginBottom: 16
    },
    title: {
      fontSize: 24,
      fontWeight: 700,
      marginBottom: 8,
      color: '#f59e0b'
    },
    subtitle: {
      fontSize: 16,
      color: '#94a3b8',
      marginBottom: 24,
      maxWidth: 300,
      lineHeight: 1.5
    },
    routeCard: {
      background: '#1e293b',
      borderRadius: 16,
      padding: 20,
      maxWidth: 340,
      width: '100%',
      border: '1px solid #334155'
    },
    routeTitle: {
      fontSize: 18,
      fontWeight: 700,
      color: '#f8fafc',
      marginBottom: 8
    },
    routeDesc: {
      fontSize: 14,
      color: '#94a3b8',
      marginBottom: 12,
      lineHeight: 1.4
    },
    meta: {
      display: 'flex',
      gap: 12,
      justifyContent: 'center',
      fontSize: 13,
      color: '#64748b'
    },
    spinner: {
      width: 48,
      height: 48,
      border: '4px solid #334155',
      borderTopColor: '#f59e0b',
      borderRadius: '50%',
      animation: 'spin 1s linear infinite',
      marginBottom: 16
    },
    errorBtn: {
      background: '#f59e0b',
      color: '#0f172a',
      border: 'none',
      borderRadius: 8,
      padding: '12px 24px',
      fontWeight: 700,
      cursor: 'pointer',
      fontSize: 14,
      marginTop: 16
    }
  };

  if (status === 'loading') {
    return (
      <div style={styles.container}>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        <div style={styles.spinner} />
        <p style={{ color: '#94a3b8' }}>Cargando ruta compartida...</p>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div style={styles.container}>
        <div style={styles.icon}>😕</div>
        <h1 style={styles.title}>Link inválido</h1>
        <p style={styles.subtitle}>
          No pudimos cargar esta ruta. El link puede estar incompleto o corrupto.
        </p>
        <button 
          style={styles.errorBtn}
          onClick={() => navigate('/', { replace: true })}
        >
          Ir a BuenaRuta
        </button>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.icon}>🏍️</div>
      <h1 style={styles.title}>¡Ruta cargada!</h1>
      <p style={styles.subtitle}>
        Te compartieron una ruta. Ya está guardada en tu app.
      </p>
      
      {route && (
        <div style={styles.routeCard}>
          <h2 style={styles.routeTitle}>{route.title}</h2>
          {route.desc && <p style={styles.routeDesc}>{route.desc}</p>}
          <div style={styles.meta}>
            {route.totalKm > 0 && <span>🛣️ {route.totalKm} km</span>}
            {route.points?.length > 0 && <span>📍 {route.points.length} puntos</span>}
            {route.provinces?.length > 0 && <span>🗺️ {route.provinces.join(', ')}</span>}
          </div>
        </div>
      )}
      
      <p style={{ color: '#64748b', fontSize: 13, marginTop: 20 }}>
        Redirigiendo a la app...
      </p>
    </div>
  );
}

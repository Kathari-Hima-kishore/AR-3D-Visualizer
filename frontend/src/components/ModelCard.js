import React, { useEffect, useRef, useState, useCallback } from 'react';
import anime from 'animejs/lib/anime.es.js';

const ModelCard = ({ model, onInteract, animationDelay = 0 }) => {
  const cardRef = useRef(null);
  const modelViewerRef = useRef(null);
  const previewRef = useRef(null);
  const pinchRef = useRef({ active: false, initialDistance: 0, initialRadius: 0 });
  const [isModelLoaded, setIsModelLoaded] = useState(false);
  // Touch capability detection must be declared before any hooks/effects that use it
  const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

  // Helper: safely parse cameraOrbit and update radius (zoom)
  const parseOrbit = useCallback((orbitStr) => {
    // orbitStr expected like: "azimuth elevation radius" where radius may have a unit like 'm'
    if (!orbitStr || typeof orbitStr !== 'string') return null;
    const parts = orbitStr.trim().split(/\s+/);
    if (parts.length < 3) return null;
    const azimuth = parts[0];
    const elevation = parts[1];
    let radiusStr = parts.slice(2).join(' ');
    // Remove trailing unit like 'm'
    radiusStr = radiusStr.replace(/m$/, '');
    const radius = parseFloat(radiusStr);
    if (Number.isNaN(radius)) return null;
    return { azimuth, elevation, radius };
  }, []);

  const setOrbitRadius = useCallback((newRadius) => {
    const mv = modelViewerRef.current;
    if (!mv) return;
    try {
      const orbitRaw = mv.cameraOrbit || (mv.getCameraOrbit ? mv.getCameraOrbit() : null);
      const parsed = parseOrbit(String(orbitRaw || '0deg 75deg 2.5m')) || { azimuth: '0deg', elevation: '75deg', radius: 2.5 };
      const azimuth = parsed.azimuth;
      const elevation = parsed.elevation;
      const radius = Math.max(0.1, newRadius); // clamp to reasonable minimum
      // Set with 'm' units
      mv.cameraOrbit = `${azimuth} ${elevation} ${radius}m`;
    } catch (e) {
      console.warn('Unable to set camera orbit:', e);
    }
  }, [parseOrbit]);

  // Compute preview camera orbit (zoom-out on small screens)
  const previewIsSmallViewport = (typeof window !== 'undefined' && (window.innerWidth <= 768 || isTouchDevice));
  // Zoom previews out by default so models don't feel too close on mobile/desktop
  const previewOrbit = previewIsSmallViewport ? '0deg 65deg 12m' : '0deg 75deg 8m';
  const previewHeight = previewIsSmallViewport ? '260px' : '300px';

  // Smoothly animate the camera radius (keeps azimuth/elevation constant)
  const animateOrbitRadius = useCallback((targetRadius, duration = 220, easing = 'easeOutQuad') => {
    const mv = modelViewerRef.current;
    if (!mv) return;
    const orbitRaw = mv.cameraOrbit || (mv.getCameraOrbit ? mv.getCameraOrbit() : '0deg 75deg 4m');
    const parsed = parseOrbit(String(orbitRaw)) || { azimuth: '0deg', elevation: '75deg', radius: 4 };
    const start = parsed.radius;
    anime.remove(mv); // stop previous animations targeting this element
    anime({
      targets: { r: start },
      r: targetRadius,
      duration,
      easing,
      update: (anim) => {
        const cur = anim.animations[0].currentValue;
        try {
          mv.cameraOrbit = `${parsed.azimuth} ${parsed.elevation} ${cur}m`;
        } catch (e) {
          // ignore
        }
      }
    });
  }, [parseOrbit]);


  useEffect(() => {
    const modelViewer = modelViewerRef.current;
    const handleModelLoad = () => setIsModelLoaded(true);

    modelViewer.addEventListener('load', handleModelLoad);

    // Animate card entrance
    anime({
      targets: cardRef.current,
      opacity: [0, 1],
      translateY: [50, 0],
      scale: [0.8, 1],
      duration: 800,
      delay: animationDelay,
      easing: 'easeOutElastic',
      elasticity: 400
    });

    // Load model-viewer script if not already loaded
    if (!window.customElements.get('model-viewer')) {
      const script = document.createElement('script');
      script.type = 'module';
      script.src = 'https://unpkg.com/@google/model-viewer/dist/model-viewer.min.js';
      document.head.appendChild(script);
    }

    // Fit the model into view once it's loaded (per-model framing)
    const fitToView = async () => {
      const mv = modelViewerRef.current;
      if (!mv) return;
      try {
        // Ensure THREE is available from model-viewer, which bundles its own version.
        const THREE = window.ModelViewer?.THREE;
        if (!THREE) {
          console.warn('THREE.js not found on window.ModelViewer. Skipping fitToView.');
          return;
        }

        // Access the loaded scene from the model-viewer's model property.
        const modelObj = mv.model?.scene;
        if (!modelObj) return;

        // Clone the object into a temporary Three.js scene to compute Box3 size
        const tmpScene = new THREE.Scene();
        tmpScene.add(modelObj.clone(true));
        const box = new THREE.Box3().setFromObject(tmpScene);
        const size = new THREE.Vector3();
        box.getSize(size);
        const maxDim = Math.max(size.x, size.y, size.z);

        if (maxDim > 0) {
          // Simplified heuristic to compute radius: scale factor * maxDim
          // Use a larger framing multiplier so models are framed further away
          // (zoomed out) by default. This avoids cropping on mobile and gives
          // a better overall initial view.
          const desiredRadius = Math.max(0.8, maxDim * 1.6);
          // Keep azimuth at 0deg (centered)
          animateOrbitRadius(desiredRadius, 420, 'easeOutCubic');
          // Also set immediately to ensure no flashing; animation will smooth
          setOrbitRadius(desiredRadius);
        }
      } catch (err) {
        // Non-fatal
        console.warn('fitToView failed', err);
      }
    };

  // Attach fit-to-view to load event so we run after GLTF parsed
  modelViewer.addEventListener('load', fitToView);

    return () => {
      modelViewer.removeEventListener('load', handleModelLoad);
      try { modelViewer.removeEventListener('load', fitToView); } catch (e) {}
    };
  }, [animationDelay, animateOrbitRadius, previewIsSmallViewport, setOrbitRadius]);

  // Added a function to clear cache when the webpage is closed
  useEffect(() => {
    const clearCacheOnUnload = () => {
      if ('caches' in window) {
        caches.keys().then(cacheNames => {
          cacheNames.forEach(cacheName => {
            caches.delete(cacheName);
          });
        });
      }
    };

    window.addEventListener('unload', clearCacheOnUnload);

    return () => {
      window.removeEventListener('unload', clearCacheOnUnload);
    };
  }, []);

  // No user interaction or AR button in preview: effect removed

  const handleInteractClick = () => {
    // Add click animation
    anime({
      targets: cardRef.current,
      scale: [1, 0.95, 1],
      duration: 200,
      easing: 'easeInOutQuad',
      complete: () => {
        onInteract(model);
      }
    });
  };

  const handleCardHover = (isHovering) => {
    anime({
      targets: cardRef.current,
      scale: isHovering ? 1.05 : 1,
      duration: 300,
      easing: 'easeOutQuad'
    });

    // Add glow effect
    anime({
      targets: cardRef.current.querySelector('.card-glow'),
      opacity: isHovering ? 0.6 : 0,
      duration: 300,
      easing: 'easeOutQuad'
    });
  };

  const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  // Device performance detection
  const isLowEndDevice = () => {
    // Simple check: 4 or fewer logical processors or user agent match
    return (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4) ||
      /android|iphone|ipad|ipod|mobile|opera mini|iemobile|wpdesktop/i.test(navigator.userAgent);
  };

  // Keep preview non-interactive: disable gestures and zoom on the preview cards.
  useEffect(() => {
    // Determine small viewport (mobile) by width or touch capability
    const mv = modelViewerRef.current;
    if (!mv) return;
    const isSmallViewport = window.innerWidth <= 768 || isTouchDevice;

    // model-viewer uses presence of the 'disable-*' attributes, so to enable
    // features we must REMOVE those attributes. For now enable camera
    // controls and gestures for both mobile and desktop so single-finger drag
    // and mouse dragging are available.
    try {
      mv.removeAttribute('disable-zoom');
      mv.removeAttribute('disable-pan');
      mv.removeAttribute('disable-tap');
      mv.setAttribute('camera-controls', '');
    } catch (e) {}
    // Allow native model-viewer gestures by default but hint for pinch-zoom.
    try { if (previewRef.current) previewRef.current.style.touchAction = 'pinch-zoom'; } catch(e){}
    try { mv.style.touchAction = 'pinch-zoom'; } catch(e){}

    // Aggressive performance flags for low-end devices (still applied)
    if (isLowEndDevice() && mv) {
      mv.setAttribute('ar', 'true');
      mv.setAttribute('exposure', '0.7');
      mv.setAttribute('shadow-intensity', '0.2');
      mv.setAttribute('shadow-softness', '0.1');
      mv.setAttribute('max-camera-orbit', 'auto auto 30%');
      mv.setAttribute('quick-look', 'false');
      mv.setAttribute('environment-image', '');
      mv.setAttribute('render-scale', '0.5');
    }
  }, [isTouchDevice]);

  



  // Preview is non-interactive; wheel/zoom are disabled for the card.
  
  const protocol = window.location.protocol === 'https:' ? 'https' : 'http';
  // Backend base URL can be overridden via REACT_APP_BACKEND_URL (useful for tunnels)
  let backendUrl = process.env.REACT_APP_BACKEND_URL;
  if (!backendUrl) {
    const hostname = window.location.hostname || '';
    if (hostname.includes('-3000')) {
      // dev-time convenience: map frontend tunnel -> backend tunnel
      const guessed = hostname.replace(/-3000/g, '-5000');
      backendUrl = `${protocol}://${guessed}`;
    } else {
      // If the page is already served from the backend tunnel/origin, use that origin
      // (window.location.origin includes host and port if present). This prevents
      // accidentally appending ':5000' to a hostname that already maps to the backend.
      backendUrl = window.location.origin;
    }
  }


  return (
    <div
      ref={cardRef}
      className="model-card"
      onMouseEnter={() => handleCardHover(true)}
      onMouseLeave={() => handleCardHover(false)}
    >
      <div className="card-glow"></div>
      <div className="model-preview" ref={previewRef}>
        <model-viewer
          ref={modelViewerRef}
          src={`${backendUrl}/models/${encodeURIComponent(model.name)}`}
          alt={`3D model: ${model.name}`}
          loading="eager"
          reveal="auto"
          auto-rotate
          auto-rotate-delay="0"
          rotation-per-second="20deg"
          camera-orbit={previewOrbit}
          draco-decoder-path={`${backendUrl}/draco/`}
          interaction-prompt="none"
          interaction-prompt-threshold="0"
          environment-image=""
          exposure="1"
          shadow-intensity="0.5"
          shadow-softness="0.5"
          style={{
            width: '100%',
            height: previewHeight,
            backgroundColor: 'transparent',
            transformStyle: 'preserve-3d'
          }}
          // No AR, no camera-controls, no user input in preview
          onLoad={() => {
            if (modelViewerRef.current) {
              modelViewerRef.current.reveal = 'auto';
              setIsModelLoaded(true);
            }
          }}
        />
        <div className="preview-overlay">
          {!isModelLoaded && (
            <div className="rotation-indicator">
              <div className="spinning-ring"></div>
            </div>
          )}
        </div>
      </div>
      <div className="card-content">
        <h3 className="model-title">{model.id}</h3>
        <div className="model-info">
          <span className="file-size">{formatFileSize(model.size)}</span>
          <span className="file-type">GLB</span>
        </div>
        {/* Interact button moved below the model preview, inside card-content */}
        <button
          className="interact-btn"
          onClick={handleInteractClick}
          style={{
            margin: '18px auto 0 auto',
            display: 'block',
            padding: '10px 28px',
            fontSize: '1.1rem',
            borderRadius: '24px',
            background: '#1e2a3a',
            color: '#fff',
            border: 'none',
            boxShadow: '0 2px 8px rgba(0,0,0,0.18)',
            cursor: 'pointer',
            opacity: isModelLoaded ? 1 : 0.5,
            pointerEvents: isModelLoaded ? 'auto' : 'none',
            transition: 'opacity 0.2s'
          }}
          disabled={!isModelLoaded}
        >
          Interact
        </button>
      </div>
    </div>
  );
};

export default ModelCard;

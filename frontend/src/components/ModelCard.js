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

  // Attach two-finger pinch handlers for mobile preview zooming
  useEffect(() => {
    const previewEl = previewRef.current;
    const mv = modelViewerRef.current;
    if (!previewEl || !mv) return;

  // use touch detection directly; no separate isSmallViewport variable needed here

    const getDistance = (t) => {
      const dx = t[0].clientX - t[1].clientX;
      const dy = t[0].clientY - t[1].clientY;
      return Math.sqrt(dx * dx + dy * dy);
    };

    // Touch/pinch handlers attached directly to model-viewer element (mv)
    const onTouchStart = (e) => {
      if (e.touches && e.touches.length === 2) {
        // begin pinch
        pinchRef.current.active = true;
        pinchRef.current.initialDistance = getDistance(e.touches);
        // read current radius from cameraOrbit or default
        const orbitRaw = mv.cameraOrbit || (mv.getCameraOrbit ? mv.getCameraOrbit() : '0deg 75deg 4m');
        const parsed = parseOrbit(String(orbitRaw)) || { radius: 4 };
        pinchRef.current.initialRadius = parsed.radius || 4;
        // Prevent page-level pinch-zoom and wheel/scroll while interacting
        try { document.addEventListener('touchmove', preventDocTouchMove, { passive: false }); } catch(e){}
        try { document.addEventListener('wheel', preventDocWheel, { passive: false }); } catch(e){}
        try { document.body && (document.body.style.overflow = 'hidden'); } catch(e){}
        try { console.debug('[ModelCard] pinch start', { initialDistance: pinchRef.current.initialDistance, initialRadius: pinchRef.current.initialRadius }); } catch(e){}
      }
    };

    const onTouchMove = (e) => {
      if (!pinchRef.current.active) return;
      if (e.touches && e.touches.length === 2) {
        // prevent page pinch-zoom and let us control camera radius
        e.preventDefault && e.preventDefault();
        const curDist = getDistance(e.touches);
        const scale = pinchRef.current.initialDistance / curDist;
        let newRadius = pinchRef.current.initialRadius * scale;
        // clamp radius
        newRadius = Math.max(0.2, Math.min(50, newRadius));
        // During move, update immediately for responsiveness
        setOrbitRadius(newRadius);
        try { console.debug('[ModelCard] pinch move', { curDist, scale, newRadius }); } catch(e){}
      }
    };

    const onTouchEnd = (e) => {
      if (!pinchRef.current.active) return;
      if (!e.touches || e.touches.length < 2) {
        pinchRef.current.active = false;
        // remove document-level prevention
        try { document.removeEventListener('touchmove', preventDocTouchMove); } catch(e){}
        try { document.removeEventListener('wheel', preventDocWheel); } catch(e){}
        try { document.body && (document.body.style.overflow = ''); } catch(e){}
        // Smoothly settle to the current radius for a nicer feel
        try {
          const mv = modelViewerRef.current;
          if (mv) {
            const parsed = parseOrbit(String(mv.cameraOrbit || '0deg 75deg 4m')) || { radius: 4 };
            animateOrbitRadius(parsed.radius, 260, 'easeOutCubic');
            try { console.debug('[ModelCard] pinch end', { settledRadius: parsed.radius }); } catch(e){}
          }
        } catch (err) {
          // ignore
        }
      }
    };

    // Wheel handler for laptop/desktop to zoom preview via scroll
    const onWheel = (e) => {
      // only handle when pointer is over the preview
      e.preventDefault && e.preventDefault();
      const mvEl = mv;
      if (!mvEl) return;
      const parsed = parseOrbit(String(mvEl.cameraOrbit || '0deg 75deg 4m')) || { radius: 4 };
      // use a smaller delta scaled by devicePixelRatio for smoother feel
      const dir = e.deltaY > 0 ? 1 : -1;
      const step = 0.6 * (window.devicePixelRatio || 1);
      const target = Math.max(0.2, Math.min(50, parsed.radius + dir * step));
      // animate wheel-initiated zoom for smoothness
      animateOrbitRadius(target, 200, 'easeOutQuad');
      try { console.debug('[ModelCard] wheel', { delta: e.deltaY, from: parsed.radius, to: target }); } catch(e){}
    };

    // Pointer events fallback (for browsers that prefer pointer events or where
    // touch-action isn't honored). We'll implement a two-pointer pinch using
    // pointerdown/pointermove/pointerup on the preview element.
    const pointerMap = new Map();
    const pointerDistance = () => {
      const pts = Array.from(pointerMap.values());
      if (pts.length < 2) return 0;
      const dx = pts[0].x - pts[1].x;
      const dy = pts[0].y - pts[1].y;
      return Math.sqrt(dx * dx + dy * dy);
    };

    const onPointerDown = (e) => {
      // Track pointer
      pointerMap.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointerMap.size === 2) {
        // begin pinch
        pinchRef.current.active = true;
        pinchRef.current.initialDistance = pointerDistance();
        const orbitRaw = mv.cameraOrbit || (mv.getCameraOrbit ? mv.getCameraOrbit() : '0deg 75deg 4m');
        const parsed = parseOrbit(String(orbitRaw)) || { radius: 4 };
        pinchRef.current.initialRadius = parsed.radius || 4;
        // Prevent page scroll and wheel while pinching
        try { document.addEventListener('touchmove', preventDocTouchMove, { passive: false }); } catch(e){}
        try { document.addEventListener('wheel', preventDocWheel, { passive: false }); } catch(e){}
        try { document.body && (document.body.style.overflow = 'hidden'); } catch(e){}
        try { console.debug('[ModelCard] pointer pinch start', { initialDistance: pinchRef.current.initialDistance, initialRadius: pinchRef.current.initialRadius }); } catch(e){}
      }
      try { previewEl.setPointerCapture && previewEl.setPointerCapture(e.pointerId); } catch(e){}
    };

    const onPointerMove = (e) => {
      if (!pointerMap.has(e.pointerId)) return;
      pointerMap.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (!pinchRef.current.active) return;
      if (pointerMap.size >= 2) {
        e.preventDefault && e.preventDefault();
        const curDist = pointerDistance();
        const scale = pinchRef.current.initialDistance / curDist;
        let newRadius = pinchRef.current.initialRadius * scale;
        newRadius = Math.max(0.2, Math.min(50, newRadius));
        setOrbitRadius(newRadius);
        try { console.debug('[ModelCard] pointer pinch move', { curDist, scale, newRadius }); } catch(e){}
      }
    };

    const onPointerUp = (e) => {
      pointerMap.delete(e.pointerId);
      try { previewEl.releasePointerCapture && previewEl.releasePointerCapture(e.pointerId); } catch(e){}
      if (pinchRef.current.active && pointerMap.size < 2) {
        pinchRef.current.active = false;
        try { document.removeEventListener('touchmove', preventDocTouchMove); } catch(e){}
        try { document.removeEventListener('wheel', preventDocWheel); } catch(e){}
        try { document.body && (document.body.style.overflow = ''); } catch(e){}
        try {
          const mv2 = modelViewerRef.current;
          if (mv2) {
            const parsed = parseOrbit(String(mv2.cameraOrbit || '0deg 75deg 4m')) || { radius: 4 };
            animateOrbitRadius(parsed.radius, 260, 'easeOutCubic');
            try { console.debug('[ModelCard] pointer pinch end', { settledRadius: parsed.radius }); } catch(e){}
          }
        } catch (err) {
          // ignore
        }
      }
    };

    // Utility used to block document scrolling/pinch while interacting
    const preventDocTouchMove = (ev) => {
      try { ev.preventDefault && ev.preventDefault(); } catch (e) {}
      return false;
    };

    const preventDocWheel = (ev) => {
      try { ev.preventDefault && ev.preventDefault(); } catch (e) {}
      return false;
    };

  // Attach listeners to model-viewer (mv) so gestures go to the model, not the page
  mv.addEventListener('touchstart', onTouchStart, { passive: false });
  mv.addEventListener('touchmove', onTouchMove, { passive: false });
  mv.addEventListener('touchend', onTouchEnd, { passive: true });
  mv.addEventListener('touchcancel', onTouchEnd, { passive: true });
  // Wheel on the preview wrapper and model-viewer (so scroll over the preview affects zoom)
  previewEl.addEventListener('wheel', onWheel, { passive: false });
  try { mv.addEventListener('wheel', onWheel, { passive: false }); } catch(e){}
  // Pointer events fallback on the preview element
  previewEl.addEventListener('pointerdown', onPointerDown);
  previewEl.addEventListener('pointermove', onPointerMove);
  previewEl.addEventListener('pointerup', onPointerUp);
  previewEl.addEventListener('pointercancel', onPointerUp);

  // Aggressive: also attach handlers directly to the internal canvas inside
  // <model-viewer> (if the shadowRoot is accessible) so we capture gestures
  // even when the component or UA tries to intercept them.
  let mvCanvas = null;
  try {
    mvCanvas = mv.shadowRoot ? mv.shadowRoot.querySelector('canvas') : mv.querySelector('canvas');
    if (mvCanvas) {
      try { mvCanvas.style.touchAction = 'none'; } catch (e) {}
      mvCanvas.addEventListener('touchstart', onTouchStart, { passive: false });
      mvCanvas.addEventListener('touchmove', onTouchMove, { passive: false });
      mvCanvas.addEventListener('touchend', onTouchEnd, { passive: true });
      mvCanvas.addEventListener('touchcancel', onTouchEnd, { passive: true });
      mvCanvas.addEventListener('pointerdown', onPointerDown);
      mvCanvas.addEventListener('pointermove', onPointerMove);
      mvCanvas.addEventListener('pointerup', onPointerUp);
      mvCanvas.addEventListener('pointercancel', onPointerUp);
      mvCanvas.addEventListener('wheel', onWheel, { passive: false });
    }
  } catch (e) {
    // ignore if shadowRoot not accessible or events fail
  }

    return () => {
      try {
        mv.removeEventListener('touchstart', onTouchStart);
        mv.removeEventListener('touchmove', onTouchMove);
        mv.removeEventListener('touchend', onTouchEnd);
        mv.removeEventListener('touchcancel', onTouchEnd);
      } catch (e) {
        // ignore detach errors
      }
      previewEl.removeEventListener('wheel', onWheel);
      previewEl.removeEventListener('pointerdown', onPointerDown);
      previewEl.removeEventListener('pointermove', onPointerMove);
      previewEl.removeEventListener('pointerup', onPointerUp);
      previewEl.removeEventListener('pointercancel', onPointerUp);
      // cleanup canvas listeners
      try {
        if (mvCanvas) {
          mvCanvas.removeEventListener('touchstart', onTouchStart);
          mvCanvas.removeEventListener('touchmove', onTouchMove);
          mvCanvas.removeEventListener('touchend', onTouchEnd);
          mvCanvas.removeEventListener('touchcancel', onTouchEnd);
          mvCanvas.removeEventListener('pointerdown', onPointerDown);
          mvCanvas.removeEventListener('pointermove', onPointerMove);
          mvCanvas.removeEventListener('pointerup', onPointerUp);
          mvCanvas.removeEventListener('pointercancel', onPointerUp);
          mvCanvas.removeEventListener('wheel', onWheel);
        }
      } catch (e) {}
    };
  }, [isTouchDevice, parseOrbit, setOrbitRadius, animateOrbitRadius]);

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

  


  // adjustZoom removed (unused) to satisfy ESLint

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

  // websocketUrl removed (unused) to satisfy ESLint

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
          reveal="auto" // Ensure model is revealed automatically
          auto-rotate
          auto-rotate-delay="0"
          rotation-per-second="20deg"
          camera-orbit={previewOrbit}
          draco-decoder-path={`${backendUrl}/draco/`}
          interaction-prompt="none"
          interaction-prompt-threshold="0"
          ar
          ar-modes="webxr scene-viewer quick-look"
          ar-placement="placement"
          environment-image=""
          exposure="1"
          shadow-intensity="0.5"
          shadow-softness="0.5"
          style={{
            width: '100%',
            height: previewHeight,
            backgroundColor: 'transparent',
            // ensure 3D rendering preserves depth and doesn't get clipped by rounding/overflow
            transformStyle: 'preserve-3d'
          }}
          onLoad={() => {
            // Only reveal model after fully loaded
            if (modelViewerRef.current) {
              modelViewerRef.current.reveal = 'auto';
              setIsModelLoaded(true); // Ensure state is updated
            }
          }}
        />
        {/* Zoom controls removed: preview is passive and only auto-rotates until Interact is clicked */}
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
        
      </div>
    </div>
  );
};

export default ModelCard;

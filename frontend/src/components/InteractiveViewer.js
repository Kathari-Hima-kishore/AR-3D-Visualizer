import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import anime from 'animejs/lib/anime.es.js';

const InteractiveViewer = ({ model, onBack }) => {
  const viewerRef = useRef(null);
  const containerRef = useRef(null);
  const pinchRef = useRef({ active: false, initialDistance: 0, initialRadius: 0 });
  const [isVRSupported, setIsVRSupported] = useState(false);
  const [isARSupported, setIsARSupported] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [isModelReady, setIsModelReady] = useState(false);

  // Detect mobile device
  const detectMobile = useCallback(() => {
    const userAgent = navigator.userAgent || navigator.vendor || window.opera;
    const isMobile = /android|avantgo|blackberry|blazer|compal|elaine|fennec|hiptop|iemobile|ip(hone|od)|iris|kindle|lge |maemo|midp|mmp|netfront|opera m(ob|in)i|palm( os)?|phone|p(ixi|re)\/|plucker|pocket|psp|series(4|6)0|symbian|treo|up\.(browser|link)|vodafone|wap|windows (ce|phone)|xda|xiino/i.test(userAgent);
    setIsMobile(isMobile);
    return isMobile;
  }, []);

  // Mobile-optimized model viewer attributes
  const mobileOptimizedAttributes = useMemo(() => {
    if (!isMobile) return {};
    return {
      // Reduce quality for faster loading on mobile
      'min-camera-orbit': 'auto auto 5%',
      'max-camera-orbit': 'auto auto 50%',
      // Optimize rendering
      'power-preference': 'high-performance',
      // Reduce shadow complexity
      'shadow-intensity': '0.5',
      'shadow-softness': '0.5',
      // Optimize auto-rotation
      'auto-rotate-delay': '5000',
      'rotation-per-second': '5deg'
    };
  }, [isMobile]);

  const toggleFullscreen = useCallback(() => {
    if (!isFullscreen) {
      containerRef.current.requestFullscreen().then(() => {
        setIsFullscreen(true);
      });
    } else {
      document.exitFullscreen().then(() => {
        setIsFullscreen(false);
      });
    }
  }, [isFullscreen]);

  useEffect(() => {
    const mobile = detectMobile();
    
    // Reduced animation duration for mobile
    const animationDuration = mobile ? 300 : 600;
    const animationElasticity = mobile ? 200 : 400;

    // Animate container entrance with mobile optimization
    anime({
      targets: containerRef.current,
      opacity: [0, 1],
      scale: [0.9, 1],
      duration: animationDuration,
      easing: 'easeOutElastic',
      elasticity: animationElasticity
    });

    // Check WebXR support
    checkWebXRSupport();

    // Load model-viewer script if not already loaded
    if (!window.customElements.get('model-viewer')) {
      const script = document.createElement('script');
      script.type = 'module';
      script.src = 'https://unpkg.com/@google/model-viewer/dist/model-viewer.min.js';
      document.head.appendChild(script);
    }

    // Add keyboard controls
    const handleKeyPress = (event) => {
      switch(event.key) {
        case 'Escape':
          if (isFullscreen) {
            exitFullscreen();
          } else {
            onBack();
          }
          break;
        case 'f':
        case 'F':
          toggleFullscreen();
          break;
        case 'r':
        case 'R':
          resetCamera();
          break;
        default:
          break;
      }
    };

    document.addEventListener('keydown', handleKeyPress);
    
    return () => {
      document.removeEventListener('keydown', handleKeyPress);
    };
  }, [isFullscreen, onBack, toggleFullscreen, detectMobile]);

  const checkWebXRSupport = async () => {
    if ('xr' in navigator) {
      try {
        const vrSupported = await navigator.xr.isSessionSupported('immersive-vr');
        const arSupported = await navigator.xr.isSessionSupported('immersive-ar');
        setIsVRSupported(vrSupported);
        setIsARSupported(arSupported);
      } catch (error) {
        console.log('WebXR not supported:', error);
      }
    }
  };

  const handleVRToggle = () => {
    if (viewerRef.current) {
      viewerRef.current.activateXR('immersive-vr');
    }
  };

  const handleARToggle = () => {
    if (viewerRef.current) {
      viewerRef.current.activateXR('immersive-ar');
    }
  };

  const exitFullscreen = () => {
    if (document.fullscreenElement) {
      document.exitFullscreen().then(() => {
        setIsFullscreen(false);
      });
    }
  };

  const resetCamera = () => {
    if (viewerRef.current) {
      viewerRef.current.resetTurntableRotation();
      
      // Add reset animation
      anime({
        targets: viewerRef.current,
        scale: [0.95, 1],
        duration: 300,
        easing: 'easeOutElastic',
        elasticity: 400
      });
    }
  };

  const handleBack = () => {
    anime({
      targets: containerRef.current,
      opacity: [1, 0],
      scale: [1, 0.9],
      duration: 400,
      easing: 'easeInQuad',
      complete: () => {
        onBack();
      }
    });
  };

  const formatModelId = (id) => {
    return id
      .replace(/_/g, ' ')
      .replace(/texture/gi, '')
      .replace(/\d+/g, '')
      .trim()
      .split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };

  // Handle model load progress
  const handleModelLoad = useCallback((event) => {
    setLoadingProgress(event.detail.progress * 100);
    if (event.detail.progress === 1) {
      setIsModelReady(true);
    }
  }, []);

  // Helper to parse cameraOrbit string (same format as ModelCard)
  const parseOrbit = useCallback((orbitStr) => {
    if (!orbitStr || typeof orbitStr !== 'string') return null;
    const parts = orbitStr.trim().split(/\s+/);
    if (parts.length < 3) return null;
    const azimuth = parts[0];
    const elevation = parts[1];
    let radiusStr = parts.slice(2).join(' ');
    radiusStr = radiusStr.replace(/m$/, '');
    const radius = parseFloat(radiusStr);
    if (Number.isNaN(radius)) return null;
    return { azimuth, elevation, radius };
  }, []);

  const setOrbitRadius = useCallback((newRadius) => {
    const mv = viewerRef.current;
    if (!mv) return;
    try {
      const orbitRaw = mv.cameraOrbit || (mv.getCameraOrbit ? mv.getCameraOrbit() : null);
      const parsed = parseOrbit(String(orbitRaw || '0deg 75deg 2.5m')) || { azimuth: '0deg', elevation: '75deg', radius: 2.5 };
      const azimuth = parsed.azimuth;
      const elevation = parsed.elevation;
      const radius = Math.max(0.1, newRadius);
      mv.cameraOrbit = `${azimuth} ${elevation} ${radius}m`;
    } catch (e) {
      console.warn('Unable to set camera orbit on interactive viewer:', e);
    }
  }, [parseOrbit]);



  const handleInteract = () => {
    if (viewerRef.current) {
      // Example interaction: Change the object's color
      const model = viewerRef.current.querySelector('model-viewer');
      if (model) {
        model.style.filter = 'hue-rotate(90deg)'; // Rotate the hue for a color change
      }
    }
  };

  return (
    <div ref={containerRef} className="interactive-viewer">
      <div className="viewer-header">
        <button 
          className="back-btn"
          onClick={handleBack}
        >
          <span>← Back to Gallery</span>
        </button>
        
        <div className="model-info">
          <h2>{formatModelId(model.id)}</h2>
        </div>

        <div className="viewer-controls">
          <button 
            className="control-btn"
            onClick={toggleFullscreen}
            title="Toggle Fullscreen"
          >
            <span className="icon">{isFullscreen ? '⊡' : '⊞'}</span>
          </button>
          
          <button 
            className="control-btn"
            onClick={resetCamera}
            title="Reset Camera"
          >
            <span className="icon">↻</span>
          </button>

          {/* VR and AR buttons removed for mobile */}
          {!isMobile && isVRSupported && (
            <button 
              className="xr-btn vr-btn"
              onClick={handleVRToggle}
              title="Enter VR Mode"
            >
              <span className="icon">🥽</span>
              <span>VR</span>
            </button>
          )}

          {!isMobile && isARSupported && (
            <button
              className="xr-btn ar-btn"
              onClick={handleARToggle}
              title="Enter AR Mode"
            >
              <span className="icon">📱</span>
              <span>AR</span>
            </button>
          )}

          <button 
            className="control-btn"
            onClick={handleInteract}
            title="Interact with Object"
          >
            <span className="icon">🖱️</span>
            <span>Interact</span>
          </button>
        </div>
      </div>

      <div className="viewer-container">
        <model-viewer
          ref={viewerRef}
          src={model.path}
          alt={`Interactive 3D model: ${model.name}`}
          camera-controls
          touch-action="none"
          style={{ width: '100%', height: '100%', backgroundColor: 'transparent' }}
          camera-orbit="0deg 75deg 12m"
          auto-rotate
          auto-rotate-delay="3000"
          rotation-per-second="10deg"
          interaction-prompt="none"
          interaction-prompt-threshold="0"
          loading="eager"
          reveal="auto"
          seamless-poster
          shadow-intensity="1"
          shadow-softness="0.75"
          exposure="1"
          tone-mapping="neutral"
          draco-decoder-path={`${(process.env.REACT_APP_BACKEND_URL || (window.location.hostname.includes('-3000') ? `${window.location.protocol}//${window.location.hostname.replace(/-3000/g, '-5000')}` : window.location.origin))}/draco/`}
          ar={isARSupported}
          ar-modes="webxr scene-viewer quick-look"
          ios-src=""
          xr-environment
          power-preference="high-performance"
          on-progress={handleModelLoad}
        />
        
        {/* Loading Progress Indicator */}
        {!isModelReady && (
          <div className="loading-overlay">
            <div className="loading-progress">
              <div className="progress-bar">
                <div
                  className="progress-fill"
                  style={{ width: `${loadingProgress}%` }}
                ></div>
              </div>
              <p>Loading: {Math.round(loadingProgress)}%</p>
            </div>
          </div>
        )}

      </div>

      <div className="viewer-footer">
        <div className="hotkeys">
          <span><kbd>ESC</kbd> Back/Exit Fullscreen</span>
          <span><kbd>F</kbd> Fullscreen</span>
          <span><kbd>R</kbd> Reset Camera</span>
        </div>
      </div>
    </div>
  );
};

export default InteractiveViewer;

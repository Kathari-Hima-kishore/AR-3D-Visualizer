import React, { useState, useEffect } from 'react';
import axios from 'axios';
import ModelCard from './components/ModelCard';
import InteractiveViewer from './components/InteractiveViewer';
import anime from 'animejs/lib/anime.es.js';
import './App.css';

function App() {
  const [models, setModels] = useState([]);
  const [selectedModel, setSelectedModel] = useState(null);
  const [isInteracting, setIsInteracting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchModels();
  }, []);

  const fetchModels = async () => {
    try {
      setLoading(true);
      let response;
      try {
        // Prefer the proxied endpoint in dev
        response = await axios.get('/api/models', { headers: { Accept: 'application/json' } });
      } catch (relErr) {
        // If the proxied request fails (proxy not active / dev-server not restarted), try the backend directly
        console.warn('Relative /api/models request failed, attempting direct backend:', relErr);
        response = await axios.get('http://localhost:5000/api/models', { headers: { Accept: 'application/json' } });
      }

      // If the server returned HTML (for example index.html) axios may still give us a string.
      // Detect that and try the backend directly as a fallback.
      if (typeof response.data === 'string' && response.data.trim().startsWith('<')) {
        console.warn('Received HTML from /api/models (probably index.html). Falling back to backend absolute URL.');
        response = await axios.get('http://localhost:5000/api/models', { headers: { Accept: 'application/json' } });
      }

      // Ensure we have the expected JSON shape (an array of models)
      if (!Array.isArray(response.data)) {
        console.error('Unexpected response from /api/models:', response.data);
        throw new Error('Unexpected API response shape; expected JSON array of models.');
      }

      // Compute backend URL robustly: prefer explicit env var, else map tunnel hostnames
      let backendUrl = process.env.REACT_APP_BACKEND_URL;
      if (!backendUrl) {
        const protocol = window.location.protocol === 'https:' ? 'https' : 'http';
        const hostname = window.location.hostname || '';
        if (hostname.includes('-3000')) {
          // Dev tunnel mapping: map frontend tunnel host -> backend tunnel host
          const guessed = hostname.replace(/-3000/g, '-5000');
          backendUrl = `${protocol}://${guessed}`;
        } else {
          // Use current origin which preserves https and port if present
          backendUrl = window.location.origin;
        }
      }

      const modelsWithFullPaths = response.data.map(model => ({
        ...model,
        path: `${backendUrl}${model.path}`
      }));

      setModels(modelsWithFullPaths);
      setError(null);
    } catch (err) {
      console.error('Error fetching models:', err);
      const protocol = window.location.protocol === 'https:' ? 'https' : 'http';
      const backendHint = process.env.REACT_APP_BACKEND_URL || `${protocol}://${window.location.hostname}${window.location.port ? `:${window.location.port}` : ''}`;
      setError(`Failed to load 3D models. Check that the backend is running (${backendHint}) and restart the React dev server so the proxy (if used) takes effect.`);
    } finally {
      setLoading(false);
    }
  };

  const handleInteract = (model) => {
    setSelectedModel(model);
    setIsInteracting(true);
    
    // Animate transition
    anime({
      targets: '.model-grid',
      opacity: [1, 0],
      scale: [1, 0.8],
      duration: 500,
      easing: 'easeInOutQuad',
      complete: () => {
        // Show interactive viewer
      }
    });
  };

  const handleBackToGrid = () => {
    anime({
      targets: '.interactive-viewer',
      opacity: [1, 0],
      scale: [1, 0.8],
      duration: 500,
      easing: 'easeInOutQuad',
      complete: () => {
        setIsInteracting(false);
        setSelectedModel(null);
        
        // Animate grid back in
        anime({
          targets: '.model-grid',
          opacity: [0, 1],
          scale: [0.8, 1],
          duration: 500,
          easing: 'easeOutElastic',
          elasticity: 400
        });
      }
    });
  };

  if (loading) {
    return (
      <div className="loading-container">
        <div className="loading-spinner"></div>
        <p>Loading 3D Models...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="error-container">
        <h2>Error Loading Models</h2>
        <p>{error}</p>
        <button onClick={fetchModels} className="retry-btn">
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="App">
      <header className="app-header">
        <h1>AR Visualizer</h1>
        <p>WebXR • WebGL</p>
      </header>

      {!isInteracting ? (
        <div className="model-grid">
          {models.length === 0 ? (
            <div className="no-models">
              <h3>No GLB files found</h3>
              <p>Add .glb files to the backend/models directory</p>
            </div>
          ) : (
            models.map((model, index) => (
              <ModelCard
                key={model.id}
                model={model}
                onInteract={handleInteract}
                animationDelay={index * 100}
              />
            ))
          )}
        </div>
      ) : (
        <InteractiveViewer
          model={selectedModel}
          onBack={handleBackToGrid}
        />
      )}
    </div>
  );
}

export default App;

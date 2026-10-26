import { Provider } from 'react-redux';
import { store } from './redux/store/store.js';
import { installMarketplaceHeader } from './utils/marketplaceRequest.js';
import React from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { BrowserRouter } from "react-router-dom";
import DeviceWrapper from './Components/DeviceWrapper/DeviceWrapper.jsx';

// Sends the page's marketplace with every API request (no-op unless VITE_PER_PAGE_MARKETPLACE).
installMarketplaceHeader(store);

ReactDOM.createRoot(document.getElementById('root')).render(
 
    <Provider store={store}>
      <BrowserRouter unstable_useTransitions={false}>
        <DeviceWrapper>
          <App />
        </DeviceWrapper>
      </BrowserRouter>
    </Provider>
 
)

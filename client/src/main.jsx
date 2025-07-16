import { Provider } from 'react-redux';
import { store } from './redux/store/store.js';
import React from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { BrowserRouter } from "react-router-dom";
import DeviceWrapper from './Components/DeviceWrapper/DeviceWrapper.jsx';

ReactDOM.createRoot(document.getElementById('root')).render(
 
    <Provider store={store}>
      <BrowserRouter>
        <DeviceWrapper>
          <App />
        </DeviceWrapper>
      </BrowserRouter>
    </Provider>
 
)

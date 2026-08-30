import { Provider } from 'react-redux';
import { store } from './redux/store/store.js';
import React from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { BrowserRouter } from "react-router-dom";
import DeviceWrapper from './Components/DeviceWrapper/DeviceWrapper.jsx';
import { ThemeProvider } from './contexts/ThemeContext.jsx';

ReactDOM.createRoot(document.getElementById('root')).render(
    <ThemeProvider>
      <Provider store={store}>
        <BrowserRouter unstable_useTransitions={false}>
          <DeviceWrapper>
            <App />
          </DeviceWrapper>
        </BrowserRouter>
      </Provider>
    </ThemeProvider>
)

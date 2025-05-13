import React from 'react';
import '@lottiefiles/lottie-player';
import { useParams } from 'react-router-dom';

const ErrorPage = () => {

  const {status}=useParams();

  const errorMessages = {
    400: "Hmm, something’s not quite right with your request. Give it another shot!",
    401: "Hold up! You need to log in first to see this part of the universe.",
    403: "Nice try, but you’re not allowed in here. Access denied.",
    404: "The page you're looking for has vanished into the void. But don’t worry, you can get back on track below.",
    408: "The request took too long — maybe it went out for coffee? Try again.",
    429: "Whoa there! Too many requests. Give it a moment and slow your roll.",
    500: "Oops! Something went wrong on our side. The tech gremlins are on it.",
    502: "Bad Gateway. Looks like the server had a miscommunication. Try refreshing.",
    503: "We’re doing a bit of maintenance or maybe just taking a quick nap. Try again soon.",
    504: "The server took too long to respond. It might be stuck in traffic."
  };


  return (
    <div className="relative flex items-center justify-center min-h-screen bg-gradient-to-br from-[#11111b] via-[#333651] to-[#6c70a0]">
      {/* Background Overlay */}
      <div className="absolute inset-0 bg-black opacity-60" />

      {/* Main Content (no background now) */}
      <div className="relative z-10 text-white font-bold max-w-xl w-full px-6 text-center space-y-6">

        {/* Lottie Animation */}
        <div className="flex justify-center">
          <lottie-player
            src="https://assets3.lottiefiles.com/packages/lf20_qp1q7mct.json"
            background="transparent"
            speed={1}
            style={{ width: 180, height: 180 }}
            loop
            autoplay
          ></lottie-player>
        </div>

        {/* 404 Text */}
        <h1 className="text-6xl md:text-8xl text-transparent bg-clip-text bg-gradient-to-r from-red-500 via-pink-500 to-yellow-400 drop-shadow-lg">
          {status}
        </h1>

        {/* Message */}
        <h2 className="text-xl md:text-3xl font-semibold">Lost?</h2>
        <p className="text-base md:text-lg font-medium text-white/90">
          {errorMessages[status] || "Something went wrong. Please try again."}
        </p>

        {/* Button */}
        <div>
          <a
            href="/"
            className="inline-block px-6 py-3 bg-gradient-to-r from-[#11111b] to-[#6c70a0] text-white text-lg rounded-full font-semibold shadow-md hover:scale-105 hover:shadow-xl transition duration-300"
          >
            🚀 Take Me Home
          </a>
        </div>
      </div>
    </div>
  );
};

export default ErrorPage;

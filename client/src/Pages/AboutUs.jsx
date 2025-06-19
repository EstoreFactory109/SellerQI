import React, { useEffect } from 'react';
import { Users, Target, Award, TrendingUp, Shield, Heart, Mail, MapPin, Phone } from 'lucide-react';
import { Link } from 'react-router-dom';
import Navbar from '../Components/Navigation/Navbar';
import Footer from '../Components/Navigation/Footer';

export default function AboutUs() {
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const values = [
    {
      icon: <Target className="w-8 h-8 text-red-500" />,
      title: "Mission-Driven",
      description: "We're committed to empowering Amazon sellers with actionable insights that drive real business growth."
    },
    {
      icon: <Shield className="w-8 h-8 text-blue-500" />,
      title: "Trust & Transparency",
      description: "We believe in honest, transparent reporting that gives sellers the complete picture of their performance."
    },
    {
      icon: <TrendingUp className="w-8 h-8 text-green-500" />,
      title: "Continuous Innovation",
      description: "We constantly evolve our platform to stay ahead of Amazon's changing landscape and our customers' needs."
    },
    {
      icon: <Heart className="w-8 h-8 text-purple-500" />,
      title: "Customer Success",
      description: "Your success is our success. We're here to support you every step of your Amazon selling journey."
    }
  ];

  const teamMembers = [
    {
      name: "Sarah Johnson",
      role: "CEO & Founder",
      image: "https://images.unsplash.com/photo-1494790108755-2616b612b634?w=300&h=300&fit=crop&crop=face",
      description: "Former Amazon executive with 10+ years of marketplace experience."
    },
    {
      name: "Michael Chen",
      role: "CTO",
      image: "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=300&h=300&fit=crop&crop=face",
      description: "Data scientist and engineer specializing in e-commerce analytics."
    },
    {
      name: "Emily Rodriguez",
      role: "Head of Product",
      image: "https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=300&h=300&fit=crop&crop=face",
      description: "Product strategist focused on creating intuitive seller experiences."
    },
    {
      name: "David Kim",
      role: "Lead Developer",
      image: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=300&h=300&fit=crop&crop=face",
      description: "Full-stack developer building scalable solutions for sellers."
    }
  ];

  const stats = [
    { number: "10,000+", label: "Sellers Helped" },
    { number: "50M+", label: "Products Analyzed" },
    { number: "99.9%", label: "Uptime" },
    { number: "24/7", label: "Support" }
  ];

  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <Navbar />

      {/* Hero Section */}
      <section className="py-20 px-4 bg-gradient-to-br from-gray-50 via-white to-gray-50">
        <div className="container mx-auto max-w-4xl text-center">
          <h1 className="text-5xl font-bold mb-6 leading-tight">
            We're on a mission to <span className="text-red-500">revolutionize</span><br />
            Amazon selling
          </h1>
          <p className="text-xl text-gray-600 mb-8 max-w-2xl mx-auto leading-relaxed">
            SellerQI was born from the frustration of Amazon sellers who were flying blind. 
            We believe every seller deserves clear, actionable insights to grow their business.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              to="/pricing"
              className="bg-[#3B4A6B] text-white px-8 py-3 rounded-lg hover:bg-[#2d3a52] transition-colors font-semibold"
            >
              Start Your Journey
            </Link>
            <Link
              to="/contact-us"
              className="border border-gray-300 text-gray-700 px-8 py-3 rounded-lg hover:bg-gray-50 transition-colors font-semibold"
            >
              Get in Touch
            </Link>
          </div>
        </div>
      </section>

      {/* Stats Section */}
      <section className="py-16 bg-white">
        <div className="container mx-auto px-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 max-w-4xl mx-auto">
            {stats.map((stat, index) => (
              <div key={index} className="text-center">
                <div className="text-4xl font-bold text-[#3B4A6B] mb-2">{stat.number}</div>
                <div className="text-gray-600 font-medium">{stat.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Our Story Section */}
      <section className="py-20 bg-gray-50">
        <div className="container mx-auto px-4">
          <div className="max-w-6xl mx-auto">
            <div className="grid md:grid-cols-2 gap-12 items-center">
              <div>
                <h2 className="text-4xl font-bold mb-6">Our Story</h2>
                <p className="text-gray-600 mb-6 text-lg leading-relaxed">
                  Founded in 2020 by a team of former Amazon executives and data scientists, 
                  SellerQI emerged from a simple observation: sellers were making crucial business 
                  decisions without access to the insights they needed.
                </p>
                <p className="text-gray-600 mb-6 text-lg leading-relaxed">
                  We've experienced the pain points firsthand - the endless spreadsheets, 
                  the guesswork, the missed opportunities. That's why we built a platform 
                  that transforms complex Amazon data into clear, actionable recommendations.
                </p>
                <p className="text-gray-600 text-lg leading-relaxed">
                  Today, we're proud to help thousands of sellers make smarter decisions, 
                  optimize their performance, and grow their businesses with confidence.
                </p>
              </div>
              <div className="bg-white rounded-2xl shadow-xl p-8">
                <div className="space-y-6">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center">
                      <Users className="w-6 h-6 text-red-500" />
                    </div>
                    <div>
                      <h4 className="font-semibold text-lg">2020</h4>
                      <p className="text-gray-600">Company Founded</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center">
                      <TrendingUp className="w-6 h-6 text-blue-500" />
                    </div>
                    <div>
                      <h4 className="font-semibold text-lg">2021</h4>
                      <p className="text-gray-600">First 1,000 Sellers</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center">
                      <Award className="w-6 h-6 text-green-500" />
                    </div>
                    <div>
                      <h4 className="font-semibold text-lg">2024</h4>
                      <p className="text-gray-600">10,000+ Happy Customers</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Values Section */}
      <section className="py-20 bg-white">
        <div className="container mx-auto px-4">
          <div className="max-w-6xl mx-auto">
            <div className="text-center mb-16">
              <h2 className="text-4xl font-bold mb-6">Our Values</h2>
              <p className="text-xl text-gray-600 max-w-2xl mx-auto">
                These core principles guide everything we do and shape how we serve our customers.
              </p>
            </div>
            <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-8">
              {values.map((value, index) => (
                <div key={index} className="text-center p-6 rounded-xl hover:shadow-lg transition-shadow">
                  <div className="flex justify-center mb-4">
                    {value.icon}
                  </div>
                  <h3 className="text-xl font-semibold mb-3">{value.title}</h3>
                  <p className="text-gray-600 leading-relaxed">{value.description}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Team Section */}
      <section className="py-20 bg-gray-50">
        <div className="container mx-auto px-4">
          <div className="max-w-6xl mx-auto">
            <div className="text-center mb-16">
              <h2 className="text-4xl font-bold mb-6">Meet Our Team</h2>
              <p className="text-xl text-gray-600 max-w-2xl mx-auto">
                We're a diverse group of Amazon experts, data scientists, and product builders 
                passionate about seller success.
              </p>
            </div>
            <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-8">
              {teamMembers.map((member, index) => (
                <div key={index} className="bg-white rounded-xl shadow-lg overflow-hidden hover:shadow-xl transition-shadow">
                  <img
                    src={member.image}
                    alt={member.name}
                    className="w-full h-64 object-cover"
                  />
                  <div className="p-6">
                    <h3 className="text-xl font-semibold mb-1">{member.name}</h3>
                    <p className="text-red-500 font-medium mb-3">{member.role}</p>
                    <p className="text-gray-600 text-sm leading-relaxed">{member.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Contact Section */}
      <section className="py-20 bg-white">
        <div className="container mx-auto px-4">
          <div className="max-w-4xl mx-auto">
            <div className="text-center mb-16">
              <h2 className="text-4xl font-bold mb-6">Get in Touch</h2>
              <p className="text-xl text-gray-600">
                Have questions? We'd love to hear from you. Reach out anytime.
              </p>
            </div>
            <div className="grid md:grid-cols-3 gap-8">
              <div className="text-center p-6 rounded-xl bg-gray-50">
                <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Mail className="w-6 h-6 text-red-500" />
                </div>
                <h3 className="text-lg font-semibold mb-2">Email Us</h3>
                <p className="text-gray-600 mb-3">Send us a message anytime</p>
                <a href="mailto:support@sellerqi.com" className="text-red-500 hover:text-red-600 font-medium">
                  support@sellerqi.com
                </a>
              </div>
              <div className="text-center p-6 rounded-xl bg-gray-50">
                <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Phone className="w-6 h-6 text-blue-500" />
                </div>
                <h3 className="text-lg font-semibold mb-2">Call Us</h3>
                <p className="text-gray-600 mb-3">Mon-Fri, 9am-6pm EST</p>
                <a href="tel:+1-555-123-4567" className="text-blue-500 hover:text-blue-600 font-medium">
                  +1 (555) 123-4567
                </a>
              </div>
              <div className="text-center p-6 rounded-xl bg-gray-50">
                <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <MapPin className="w-6 h-6 text-green-500" />
                </div>
                <h3 className="text-lg font-semibold mb-2">Visit Us</h3>
                <p className="text-gray-600 mb-3">Our headquarters</p>
                <p className="text-green-500 hover:text-green-600 font-medium">
                  San Francisco, CA
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20 bg-[#3B4A6B]">
        <div className="container mx-auto px-4 text-center">
          <div className="max-w-3xl mx-auto">
            <h2 className="text-4xl font-bold text-white mb-6">
              Ready to Transform Your Amazon Business?
            </h2>
            <p className="text-xl text-blue-100 mb-8">
              Join thousands of sellers who trust SellerQI to grow their Amazon business.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link
                to="/pricing"
                className="bg-red-500 text-white px-8 py-3 rounded-lg hover:bg-red-600 transition-colors font-semibold"
              >
                Start Free Trial
              </Link>
              <Link
                to="/contact-us"
                className="border border-blue-200 text-white px-8 py-3 rounded-lg hover:bg-blue-800 transition-colors font-semibold"
              >
                Schedule Demo
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <Footer />
    </div>
  );
} 
import React from 'react';
import './Home.css';

const Home = () => {
    return (
        <div className="home-container">
            <header className="home-header">
                <h1>Welcome to Ethertrack</h1>
                <p>Your comprehensive blockchain solution for emission tracking and carbon credits trading.</p>
                <button className="btn-primary">Get Started</button>
            </header>
            <section className="home-features">
                <h2>Features</h2>
                <div className="feature">
                    <h3>Emission Tracking</h3>
                    <p>Track and manage your carbon emissions effortlessly.</p>
                </div>
                <div className="feature">
                    <h3>Carbon Credits Trading</h3>
                    <p>Buy, sell, and trade carbon credits with ease.</p>
                </div>
                <div className="feature">
                    <h3>Blockchain Integration</h3>
                    <p>Seamlessly integrate with blockchain technology.</p>
                </div>
            </section>
            <section className="home-call-to-action">
                <h2>Join Us Today</h2>
                <p>Be a part of the future of blockchain technology. Sign up now!</p>
                <button className="btn-primary">Sign Up</button>
            </section>
        </div>
    );
};

export default Home;

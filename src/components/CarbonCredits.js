import React, { useState, useEffect } from 'react';
import Web3 from 'web3';
import './CarbonCredits.css';
import KYCForm from "./KYCForm";
import { FaWallet, FaList, FaBook, FaChartLine, FaHistory, FaTrophy, FaIdCard, FaArrowLeft, FaArrowRight, FaQuestionCircle, FaShieldAlt, FaUserCircle } from 'react-icons/fa';

import OrderForm from './OrderForm';
import OrderBook from './OrderBook';
import TradingViewWidget from './TradingViewWidget';
import TradingHistory from './TradingHistory';
import Leaderboard from './leaderboard';
import WalletBox from './WalletBox';
import PrivacyPolicy from './PrivacyPolicy';
import MyCredits from './MyCredits';

const CarbonCreditsTrading = () => {
    const [isKYCVerified, setIsKYCVerified] = useState(false);

    return (
        <CarbonTrading isKYCVerified={isKYCVerified} setIsKYCVerified={setIsKYCVerified} />
    );
};

const CarbonTrading = ({ isKYCVerified, setIsKYCVerified }) => {
    const [web3, setWeb3] = useState(null);
    const [account, setAccount] = useState(null);
    const [activeTab, setActiveTab] = useState('wallet');
    const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

    useEffect(() => {
        if (window.ethereum) {
            const web3Instance = new Web3(window.ethereum);
            setWeb3(web3Instance);
        } else {
            alert("MetaMask not found. Please install MetaMask.");
        }
    }, []);

    const requireKYC = (content) => {
        if (!isKYCVerified && (activeTab === 'orderForm' || activeTab === 'tradingHistory')) {
            return (
                <div className="kyc-prompt">
                    <p>⚠️ Please complete KYC before placing orders or transactions.</p>
                    <KYCForm onComplete={() => setIsKYCVerified(true)} />
                </div>
            );
        }
        return content;
    };

    const renderContent = () => {
        switch (activeTab) {
            case 'wallet': return <WalletBox />;
            case 'orderForm': return requireKYC(<OrderForm web3={web3} account={account} />);
            case 'orderBook': return <OrderBook />;
            case 'tradingHistory': return requireKYC(<TradingHistory />);
            case 'leaderboard': return <Leaderboard />;
            case 'chart': return <TradingViewWidget />;
            case 'kyc': return <KYCForm onComplete={() => setIsKYCVerified(true)} />;
            case 'privacyPolicy': return <PrivacyPolicy />;
            case 'myCredits': return <MyCredits />;
            default: return <WalletBox />;
        }
    };

    return (
        <div className="main-container">
            {/* Sidebar */}
            <div className={`sidebar ${isSidebarCollapsed ? 'collapsed' : ''}`}>
                <div className="toggle-btn" onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}>
                    {isSidebarCollapsed ? <FaArrowRight /> : <FaArrowLeft />}
                </div>

                <div className={`sidebar-item ${activeTab === 'kyc' ? 'active' : ''}`}
                     onClick={() => setActiveTab('kyc')}>
                    <FaIdCard />
                    {!isSidebarCollapsed && <span>KYC</span>}
                </div>

                <div className={`sidebar-item ${activeTab === 'wallet' ? 'active' : ''}`}
                     onClick={() => setActiveTab('wallet')}>
                    <FaWallet />
                    {!isSidebarCollapsed && <span>Wallet</span>}
                </div>

                <div className={`sidebar-item ${activeTab === 'myCredits' ? 'active' : ''}`}
                     onClick={() => setActiveTab('myCredits')}>
                    <FaUserCircle />
                    {!isSidebarCollapsed && <span>My Credits</span>}
                </div>

                <div className={`sidebar-item ${activeTab === 'orderForm' ? 'active' : ''}`}
                     onClick={() => setActiveTab('orderForm')}>
                    <FaList />
                    {!isSidebarCollapsed && <span>Order Form</span>}
                </div>

                <div className={`sidebar-item ${activeTab === 'orderBook' ? 'active' : ''}`}
                     onClick={() => setActiveTab('orderBook')}>
                    <FaBook />
                    {!isSidebarCollapsed && <span>Order Book</span>}
                </div>

                <div className={`sidebar-item ${activeTab === 'tradingHistory' ? 'active' : ''}`}
                     onClick={() => setActiveTab('tradingHistory')}>
                    <FaHistory />
                    {!isSidebarCollapsed && <span>Transaction History</span>}
                </div>

                <div className={`sidebar-item ${activeTab === 'leaderboard' ? 'active' : ''}`}
                     onClick={() => setActiveTab('leaderboard')}>
                    <FaTrophy />
                    {!isSidebarCollapsed && <span>Leaderboard</span>}
                </div>

                <div className={`sidebar-item ${activeTab === 'chart' ? 'active' : ''}`}
                     onClick={() => setActiveTab('chart')}>
                    <FaChartLine />
                    {!isSidebarCollapsed && <span>Live Chart</span>}
                </div>

                <div className={`sidebar-item ${activeTab === 'privacyPolicy' ? 'active' : ''}`}
                     onClick={() => setActiveTab('privacyPolicy')}>
                    <FaShieldAlt />
                    {!isSidebarCollapsed && <span>Privacy Policy</span>}
                </div>

            </div>

            {/* Content Area */}
            <div className="content-area">
                {renderContent()}
            </div>
        </div>
    );
};

export default CarbonCreditsTrading;

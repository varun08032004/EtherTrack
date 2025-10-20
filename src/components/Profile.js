import React, { useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import { AuthContext } from '../App';
import './Profile.css';

const Profile = () => {
    const { user, handleLogout } = useContext(AuthContext);
    const navigate = useNavigate();

    const handleEditProfile = () => {
        console.log("Navigating to Edit Profile"); // Debugging log
        navigate('/edit-profile'); // Redirect to Edit Profile
    };

    return (
        <div className="profile-container">
            <h2>Your Profile</h2>
            <div className="profile-card">
                <img 
                    src={user.profilePicture || 'https://via.placeholder.com/150'} 
                    alt="Profile" 
                    className="profile-image"
                />
                <div className="profile-details">
                    <p><strong>Name:</strong> {user.name || 'N/A'}</p>
                    <p><strong>Email:</strong> {user.email || 'N/A'}</p>
                </div>
                <div className="profile-actions">
                    <button className="edit-btn" onClick={handleEditProfile}>
                        Edit Profile
                    </button>
                    <button className="logout-btn" onClick={handleLogout}>
                        Logout
                    </button>
                </div>
            </div>
        </div>
    );
};

export default Profile;

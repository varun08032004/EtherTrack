import React, { useContext } from 'react';
import { AuthContext } from '../App';
import './Profile.css'; // Make sure to import the CSS file

const Profile = () => {
    const { user } = useContext(AuthContext);

    return (
        <div className="profile-container">
            <h2>Your Profile</h2>
            <div className="profile-details">
                <p>Email: {user.email}</p>
                {/* Add more user details as needed */}
            </div>
            <button onClick={() => alert('Profile editing feature to be implemented')}>Edit Profile</button>
        </div>
    );
};

export default Profile;

import React, { useState, useContext } from 'react';
import { AuthContext } from '../App';
import { useNavigate } from 'react-router-dom';
import './EditProfile.css';

const EditProfile = () => {
    const { user, setUser } = useContext(AuthContext);
    const [name, setName] = useState(user?.name || '');
    const [email, setEmail] = useState(user?.email || '');
    const [profilePicture, setProfilePicture] = useState(user?.profilePicture || '');
    const [error, setError] = useState('');
    const navigate = useNavigate();

    const handleImageChange = (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onloadend = () => {
                setProfilePicture(reader.result);
            };
            reader.readAsDataURL(file);
        }
    };

    const handleSave = () => {
        if (!name.trim() || !email.trim()) {
            setError('Both fields are required.');
            return;
        }
        if (!/\S+@\S+\.\S+/.test(email)) {
            setError('Invalid email format.');
            return;
        }
        const updatedUser = { ...user, name, email, profilePicture };
        setUser(updatedUser);
        localStorage.setItem('user', JSON.stringify(updatedUser)); // Persist in local storage
        navigate('/profile'); 
    };

    return (
        <div className="edit-profile-container">
            <h2>Edit Profile</h2>
            {error && <p className="error-message">{error}</p>}

            <div className="profile-picture-section">
                <img 
                    src={profilePicture || 'https://via.placeholder.com/150'} 
                    alt="Profile Preview" 
                    className="profile-preview"
                />
                <input type="file" accept="image/*" onChange={handleImageChange} />
            </div>

            <input 
                type="text" 
                value={name} 
                onChange={(e) => setName(e.target.value)} 
                placeholder="Name" 
            />
            <input 
                type="email" 
                value={email} 
                onChange={(e) => setEmail(e.target.value)} 
                placeholder="Email" 
            />
            
            <div className="button-group">
                <button className="save-btn" onClick={handleSave}>Save Changes</button>
                <button className="cancel-btn" onClick={() => navigate('/profile')}>Cancel</button>
            </div>
        </div>
    );
};

export default EditProfile;

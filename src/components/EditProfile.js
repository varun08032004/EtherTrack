import React, { useState, useContext } from 'react';
import { AuthContext } from '../App';

const EditProfile = () => {
    const { user, setUser } = useContext(AuthContext);
    const [email, setEmail] = useState(user.email);

    const handleSave = () => {
        setUser({ ...user, email }); // Update the user email
        alert(`Profile updated: ${email}`);
    };

    return (
        <div className="edit-profile-container">
            <h1>Edit Profile</h1>
            <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
            />
            <button onClick={handleSave}>Save</button>
        </div>
    );
};

export default EditProfile;

// src/components/UserInfo.js
import React, { useState } from 'react';
import './UserInfo.css';

const UserInfo = ({ user, onSave }) => {
    const [isEditing, setIsEditing] = useState(false);
    const [formData, setFormData] = useState({ ...user });

    const handleChange = (e) => {
        const { name, value } = e.target;
        setFormData({
            ...formData,
            [name]: value
        });
    };

    const handleSave = () => {
        onSave(formData);
        setIsEditing(false);
    };

    return (
        <div className="user-info">
            <div className="profile-header">
                <img src={formData.profilePicture} alt={`${formData.name}'s profile`} className="profile-picture" />
                <div className="profile-details">
                    {isEditing ? (
                        <div className="edit-form">
                            <label>
                                Name:
                                <input
                                    type="text"
                                    name="name"
                                    value={formData.name}
                                    onChange={handleChange}
                                />
                            </label>
                            <label>
                                Email:
                                <input
                                    type="email"
                                    name="email"
                                    value={formData.email}
                                    onChange={handleChange}
                                />
                            </label>
                            <label>
                                Phone:
                                <input
                                    type="text"
                                    name="phone"
                                    value={formData.phone}
                                    onChange={handleChange}
                                />
                            </label>
                            <label>
                                Address:
                                <input
                                    type="text"
                                    name="address"
                                    value={formData.address}
                                    onChange={handleChange}
                                />
                            </label>
                            <label>
                                Joined Date:
                                <input
                                    type="date"
                                    name="joinedDate"
                                    value={new Date(formData.joinedDate).toISOString().split('T')[0]}
                                    onChange={handleChange}
                                />
                            </label>
                            <button onClick={handleSave}>Save</button>
                            <button onClick={() => setIsEditing(false)}>Cancel</button>
                        </div>
                    ) : (
                        <div>
                            <h2 className="user-name">{formData.name}</h2>
                            <p className="user-email">{formData.email}</p>
                            <p className="user-role">{formData.role}</p>
                            <p className="user-id">User ID: {formData.id}</p>
                            <p><strong>Phone:</strong> {formData.phone}</p>
                            <p><strong>Address:</strong> {formData.address}</p>
                            <p><strong>Joined:</strong> {new Date(formData.joinedDate).toLocaleDateString()}</p>
                            <button className="edit-btn" onClick={() => setIsEditing(true)}>Edit</button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default UserInfo;

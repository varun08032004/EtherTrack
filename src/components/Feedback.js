import React, { useState } from 'react';
import './Feedback.css';

const Feedback = () => {
    const [feedback, setFeedback] = useState('');
    const [submitted, setSubmitted] = useState(false);

    const handleChange = (e) => {
        setFeedback(e.target.value);
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        // Example API call - replace with actual API call
        try {
            await submitFeedback(feedback);
            setFeedback('');
            setSubmitted(true);
        } catch (error) {
            console.error('Error submitting feedback:', error);
        }
    };

    const submitFeedback = async (feedback) => {
        // Replace with actual API call to submit feedback
        return new Promise((resolve) => setTimeout(resolve, 1000));
    };

    return (
        <div className="feedback-container">
            <h1>Feedback</h1>
            {submitted ? (
                <div className="feedback-success">
                    <h2>Thank you for your feedback!</h2>
                </div>
            ) : (
                <form className="feedback-form" onSubmit={handleSubmit}>
                    <textarea
                        value={feedback}
                        onChange={handleChange}
                        placeholder="Your feedback..."
                        rows="5"
                        required
                    ></textarea>
                    <button type="submit" className="btn-primary">Submit</button>
                </form>
            )}
        </div>
    );
};

export default Feedback;

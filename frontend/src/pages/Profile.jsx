import { useEffect, useState } from 'react';
import { api } from '../api/client';
import Button from '../components/Button';
import Card from '../components/Card';
import Input from '../components/Input';

export default function Profile() {
    const [preferences, setPreferences] = useState({
        home_city: '',
        interests: '',
        default_budget: '',
        travel_style: '',
    });

    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');

    useEffect(() => {
        async function loadPreferences() {
            try {
                const data = await api.get('/me/preferences');

                setPreferences({
                    home_city: data.home_city || '',
                    interests: data.interests || '',
                    default_budget: data.default_budget ?? '',
                    travel_style: data.travel_style || '',
                });
            } catch (err) {
                setError(err.message || 'Could not load your preferences.');
            } finally {
                setLoading(false);
            }
        }

        loadPreferences();
    }, []);

    function handleChange(event) {
        const { name, value } = event.target;

        setPreferences((current) => ({
            ...current,
            [name]: value,
        }));
    }

    async function handleSubmit(event) {
        event.preventDefault();
        setSaving(true);
        setMessage('');
        setError('');

        try {
            const data = await api.put('/me/preferences', {
                home_city: preferences.home_city,
                interests: preferences.interests,
                default_budget:
                    preferences.default_budget === ''
                        ? null
                        : Number(preferences.default_budget),
                travel_style: preferences.travel_style,
            });

            setPreferences({
                home_city: data.home_city || '',
                interests: data.interests || '',
                default_budget: data.default_budget ?? '',
                travel_style: data.travel_style || '',
            });

            setMessage('Preferences saved successfully.');
        } catch (err) {
            setError(err.message || 'Could not save your preferences.');
        } finally {
            setSaving(false);
        }
    }

    if (loading) {
        return (
            <section className="container">
                <h1>Profile</h1>
                <p>Loading your preferences...</p>
            </section>
        );
    }

    return (
        <section className="container">
            <h1>Profile</h1>
            <p>Manage your travel preferences.</p>

            <Card as="section" padding="lg">
                <form onSubmit={handleSubmit}>
                    <Input
                        label="Home city"
                        name="home_city"
                        value={preferences.home_city}
                        onChange={handleChange}
                        placeholder="Fort Worth"
                    />

                    <Input
                        label="Interests"
                        name="interests"
                        value={preferences.interests}
                        onChange={handleChange}
                        placeholder="Food, sightseeing, museums"
                        hint="Separate multiple interests with commas."
                    />

                    <Input
                        label="Default budget"
                        name="default_budget"
                        type="number"
                        min="0"
                        step="0.01"
                        value={preferences.default_budget}
                        onChange={handleChange}
                        placeholder="1500"
                    />

                    <Input
                        label="Travel style"
                        name="travel_style"
                        value={preferences.travel_style}
                        onChange={handleChange}
                        placeholder="Relaxed"
                    />

                    {error && <p role="alert">{error}</p>}
                    {message && <p role="status">{message}</p>}

                    <Button
                        type="submit"
                        loading={saving}
                        loadingText="Saving..."
                    >
                        Save preferences
                    </Button>
                </form>
            </Card>
        </section>
    );
}
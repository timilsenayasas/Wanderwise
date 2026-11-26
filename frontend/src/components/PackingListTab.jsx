import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';

const SECTIONS = [
  { id: 'clothing', title: 'Clothing' },
  { id: 'weather_essentials', title: 'Weather Essentials' },
  { id: 'activity_gear', title: 'Activity Gear' },
  { id: 'personal_essentials', title: 'Personal Essentials' },
];

export default function PackingListTab({ trip }) {
  const [packingList, setPackingList] = useState(null);
  const [checkedItems, setCheckedItems] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const generateList = useCallback(async () => {
    if (!trip?.id) return;

    setLoading(true);
    setError('');

    try {
      const response = await api.post(
        `/trips/${trip.id}/packing-list`,
        {}
      );

      setPackingList(response);
      setCheckedItems({});
    } catch (err) {
      setError(
        err.message || 'Unable to generate your packing list. Please try again.'
      );
    } finally {
      setLoading(false);
    }
  }, [trip?.id]);

  useEffect(() => {
    generateList();
  }, [generateList]);

  function toggleItem(section, item) {
    const key = `${section}-${item}`;

    setCheckedItems((previous) => ({
      ...previous,
      [key]: !previous[key],
    }));
  }

  if (loading) {
    return <p>Generating your packing list...</p>;
  }

  if (error) {
    return (
      <div>
        <p role="alert">{error}</p>
        <button type="button" onClick={generateList}>
          Try Again
        </button>
      </div>
    );
  }

  if (!packingList?.sections) {
    return <p>No packing list is available yet.</p>;
  }

  const totalItems = SECTIONS.reduce(
    (total, section) =>
      total + (packingList.sections[section.id]?.length || 0),
    0
  );

  const completedItems = Object.values(checkedItems).filter(Boolean).length;

  return (
    <div className="packing-list">
      <h2>Packing List</h2>

      <p>
        Your packing recommendations for {packingList.destination}.
      </p>

      <p>
        {completedItems} of {totalItems} items packed
      </p>

      {SECTIONS.map((section) => {
        const items = packingList.sections[section.id] || [];

        return (
          <section key={section.id} className="packing-section">
            <h3>{section.title}</h3>

            {items.length === 0 ? (
              <p>No items in this section.</p>
            ) : (
              items.map((item) => {
                const key = `${section.id}-${item}`;

                return (
                  <label key={key} className="packing-item">
                    <input
                      type="checkbox"
                      checked={Boolean(checkedItems[key])}
                      onChange={() => toggleItem(section.id, item)}
                    />
                    <span>{item}</span>
                  </label>
                );
              })
            )}
          </section>
        );
      })}
    </div>
  );
}
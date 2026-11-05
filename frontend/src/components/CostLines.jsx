import { useEffect, useState } from 'react';
import { api } from '../api/client';
import Button from './Button';
import Card from './Card';
import CostLineForm from './CostLineForm';
import { categoryLabel } from '../lib/budget';
import { formatCurrency, formatShortDay } from '../lib/format';
import './CostLines.css';

/**
 * A3: the trip's cost lines, using A2's /cost-items endpoints.
 * Plan lines are read-only; the traveler's own lines can be added, edited and deleted.
 *   <CostLines trip={trip} items={budget.items} onChanged={reloadTotals} />
 * onChanged runs after every change so the totals above stay correct.
 */
const ADD_BUTTON_ID = 'cost-lines-add';
const editButtonId = (line) => `cost-line-${line.id}-edit`;
const cancelDeleteId = (line) => `cost-line-${line.id}-cancel-delete`;

export default function CostLines({ trip, items, onChanged, onShowStay }) {
  const [editing, setEditing] = useState(null); // null | 'new' | a line id
  const [confirmingDelete, setConfirmingDelete] = useState(null); // a line id
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [focusTarget, setFocusTarget] = useState(null); // element id to focus after the next render

  // Put focus back where it was once a form or confirm closes, so keyboard users aren't lost.
  useEffect(() => {
    if (!focusTarget) return;
    document.getElementById(focusTarget)?.focus();
    setFocusTarget(null);
  }, [focusTarget, items]);

  function openForm(target) {
    setEditing(target);
    setConfirmingDelete(null);
    setDeleteError('');
  }

  function closeForm() {
    setFocusTarget(editing === 'new' ? ADD_BUTTON_ID : editButtonId({ id: editing }));
    setEditing(null);
  }

  async function save(values) {
    if (editing === 'new') await api.post(`/trips/${trip.id}/cost-items`, values);
    else await api.put(`/trips/${trip.id}/cost-items/${editing}`, values);
    await onChanged();
    closeForm();
  }

  function askToDelete(line) {
    setConfirmingDelete(line.id);
    setEditing(null);
    setDeleteError('');
    // The Delete button is replaced by the confirm; start on Cancel so a second Enter can't delete.
    setFocusTarget(cancelDeleteId(line));
  }

  function cancelDelete(line) {
    setConfirmingDelete(null);
    setDeleteError('');
    setFocusTarget(editButtonId(line));
  }

  async function remove(line) {
    setDeleting(true);
    setDeleteError('');
    try {
      await api.delete(`/trips/${trip.id}/cost-items/${line.id}`);
      setConfirmingDelete(null);
      await onChanged();
      setFocusTarget(ADD_BUTTON_ID);
    } catch (err) {
      setDeleteError(err.message || 'Could not delete this cost. Please try again.');
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Card as="section" padding="lg" className="cost-lines" aria-labelledby="cost-lines-title">
      <div className="cost-lines__bar">
        <h3 id="cost-lines-title">Cost lines</h3>
        {editing !== 'new' && (
          <Button id={ADD_BUTTON_ID} variant="secondary" onClick={() => openForm('new')}>
            Add a cost
          </Button>
        )}
      </div>

      {editing === 'new' && <CostLineForm trip={trip} onSave={save} onCancel={closeForm} />}

      {items.length === 0 ? (
        <p className="text-muted">Nothing here yet. Add hotels, tickets or anything else the plan doesn&apos;t include.</p>
      ) : (
        <ul className="cost-lines__list">
          {items.map((line) => (
            <li key={line.id} className="cost-line">
              {editing === line.id ? (
                <CostLineForm trip={trip} line={line} onSave={save} onCancel={closeForm} />
              ) : (
                <CostLine
                  line={line}
                  confirming={confirmingDelete === line.id}
                  deleting={deleting}
                  deleteError={confirmingDelete === line.id ? deleteError : ''}
                  onEdit={() => openForm(line.id)}
                  onAskToDelete={() => askToDelete(line)}
                  onCancelDelete={() => cancelDelete(line)}
                  onDelete={() => remove(line)}
                  onShowStay={onShowStay}
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** Plan lines are named by category ("Food", "2 activities"); user lines by their description. */
function lineText(line) {
  const category = categoryLabel(line.category);
  if (line.source === 'plan') return { title: category, detail: line.description };
  return { title: line.description || category, detail: line.description ? category : null };
}

function CostLine({ line, confirming, deleting, deleteError, onEdit, onAskToDelete, onCancelDelete, onDelete, onShowStay }) {
  const { title, detail } = lineText(line);
  const isPlan = line.source === 'plan';
  // The Where to stay choice's line changes with the choice, so it's edited on the Stay tab.
  const fromStay = Boolean(line.from_stay);

  return (
    <>
      <div className="cost-line__row">
        <div className="cost-line__text">
          <span className="cost-line__title">{title}</span>
          <span className="cost-line__meta">
            {[detail, line.trip_date && formatShortDay(line.trip_date)].filter(Boolean).join(' · ')}
            {isPlan && <span className="cost-line__badge">From your plan</span>}
            {fromStay && <span className="cost-line__badge">From Stay</span>}
          </span>
        </div>
        <span className="cost-line__amount">{formatCurrency(line.amount)}</span>
      </div>

      {fromStay && onShowStay && (
        <div className="cost-line__actions">
          <Button variant="ghost" onClick={onShowStay}>
            Change on the Stay tab
          </Button>
        </div>
      )}

      {!isPlan && !fromStay && !confirming && (
        <div className="cost-line__actions">
          <Button id={editButtonId(line)} variant="ghost" onClick={onEdit} aria-label={`Edit ${title}`}>
            Edit
          </Button>
          <Button variant="ghost" onClick={onAskToDelete} aria-label={`Delete ${title}`}>
            Delete
          </Button>
        </div>
      )}

      {confirming && (
        <div className="cost-line__confirm">
          <p>Delete &ldquo;{title}&rdquo;? This can&apos;t be undone.</p>
          {deleteError && (
            <p className="cost-line__alert" role="alert">
              {deleteError}
            </p>
          )}
          <div className="cost-line__actions">
            <Button variant="accent" onClick={onDelete} loading={deleting} loadingText="Deleting…">
              Delete
            </Button>
            <Button id={cancelDeleteId(line)} variant="ghost" onClick={onCancelDelete} disabled={deleting}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </>
  );
}

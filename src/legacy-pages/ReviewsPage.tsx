'use client';

import { useState } from 'react';
import { Link, useSearchParams } from '../lib/nextRouter';
import { Logo } from '../components/Logo';
import { emailApproveFromLink, emailReviseFromLink } from '../lib/swaStewaApi';

export function ReviewsPage() {
  const [params] = useSearchParams();
  const reportId = params?.get('report') ?? '';
  const action = params?.get('action') ?? '';
  const token = params?.get('token') ?? '';

  const [comment, setComment] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const invalid = !reportId || !token || !['approve', 'revise'].includes(action);

  const handleApprove = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await emailApproveFromLink(reportId, token);
      setMessage(res.message);
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Approval failed');
    } finally {
      setLoading(false);
    }
  };

  const handleRevise = async () => {
    if (!comment.trim()) {
      setError('Please enter revision comments for Engineer I.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await emailReviseFromLink(reportId, token, comment);
      setMessage(res.message);
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send revision request');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface p-6">
      <div className="w-full max-w-lg rounded-3xl border border-border bg-card p-8 shadow-xl">
        <Logo size="sm" showText={false} />
        <h1 className="mt-6 text-xl font-bold text-text">Email Review Action</h1>

        {invalid ? (
          <p className="mt-4 text-sm text-red-600">Invalid review link. Open the report from the Review Queue.</p>
        ) : done ? (
          <div className="mt-4 rounded-xl bg-primary-light p-4 text-sm text-primary">
            <p className="font-semibold">{message}</p>
            <Link to="/workflow" className="mt-3 inline-block underline">
              Open Review Queue
            </Link>
          </div>
        ) : action === 'approve' ? (
          <div className="mt-4">
            <p className="text-sm text-text-muted">
              Approve this report and forward it to Engineer III for final checking?
            </p>
            {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
            <button
              type="button"
              disabled={loading}
              onClick={handleApprove}
              className="mt-4 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
            >
              {loading ? 'Processing…' : 'Confirm Approve'}
            </button>
            <p className="mt-4 text-xs text-text-muted">
              Or <Link to="/workflow" className="underline">open the full Review Queue</Link> to add comments.
            </p>
          </div>
        ) : (
          <div className="mt-4">
            <p className="text-sm text-text-muted">Request revisions from Engineer I:</p>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={4}
              className="mt-3 w-full rounded-xl border border-border bg-surface-muted p-3 text-sm"
              placeholder="Revision comments..."
            />
            {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
            <button
              type="button"
              disabled={loading}
              onClick={handleRevise}
              className="mt-3 rounded-xl border border-border px-5 py-2.5 text-sm font-semibold disabled:opacity-50"
            >
              {loading ? 'Sending…' : 'Send Revision Request'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

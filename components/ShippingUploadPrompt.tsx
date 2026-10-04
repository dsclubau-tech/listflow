"use client";
import { useState } from 'react';
import type { UploadShippingConfirmation } from '@/lib/amazon-upload-shipping-policy';

export default function ShippingUploadPrompt({ confirmation, title, onComplete }: {
  confirmation: UploadShippingConfirmation; title?: string; onComplete: () => void | Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function decide(action: 'retry' | 'approve' | 'cancel') {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      const response = await fetch(action === 'cancel' ? '/api/upload/shipping-confirmation' : '/api/upload', {
        method: action === 'cancel' ? 'DELETE' : 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(action === 'cancel' ? { shippingConfirmation: confirmation } : {
          productId: confirmation.productId, background: true,
          ...(action === 'approve' ? { shippingConfirmation: confirmation } : {}),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : 'Could not process your shipping decision.');
      await onComplete();
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Please try again.'); }
    finally { setBusy(false); }
  }
  return <div role="region" aria-label="Shipping confirmation" className="m-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
    {title && <p className="font-medium">{title}</p>}
    <p>Amazon delivery time could not be verified. This item is still a draft.</p>
    <p className="mt-1 text-xs">Upload anyway applies only to this attempt and does not override a confirmed shipping delay.</p>
    <div className="mt-2 flex flex-wrap gap-2">
      <button type="button" disabled={busy} onClick={() => void decide('retry')} className="rounded border px-3 py-1">Retry check</button>
      <button type="button" disabled={busy} onClick={() => void decide('approve')} className="rounded border px-3 py-1">Upload anyway</button>
      <button type="button" disabled={busy} onClick={() => void decide('cancel')} className="rounded border px-3 py-1">Cancel</button>
    </div>
    {error && <p role="alert" className="mt-2 text-red-700">{error}</p>}
  </div>;
}

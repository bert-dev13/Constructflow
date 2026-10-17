'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from '../lib/nextRouter';
import { PayItemSelect } from '../components/PayItemSelect';
import { PageHeader } from '../components/ui/PageHeader';
import { Pagination } from '../components/ui/Pagination';
import { usePagination } from '../hooks/usePagination';
import {
  listProjectBoq,
  projectBoqAmount,
  saveProjectBoqItem,
  setProjectBoqActive,
  type ProjectBoqItem,
} from '../lib/projectBoqApi';
import type { PayItem } from '../lib/payItemsApi';
import { useSelectedProject } from '../context/SelectedProjectContext';
function formatMoney(value: number) {
  return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function emptyRow(projectId: string): ProjectBoqItem {
  return {
    id: `new-${Date.now()}`,
    projectId,
    payItemId: '',
    payItemVersion: 1,
    itemNo: '',
    description: '',
    unit: '',
    programmedQty: 0,
    revisedQty: null,
    unitPrice: 0,
    weightPct: null,
    active: true,
    createdAt: '',
    updatedAt: '',
  };
}

export function ProjectBoqPage() {
  const { projectId: routeProjectId } = useParams<{ projectId?: string }>();
  const [searchParams] = useSearchParams();
  const { projectId: selectedProjectId, setProjectId } = useSelectedProject();
  const id = String(
    searchParams?.get('projectId')
      || searchParams?.get('id')
      || routeProjectId
      || selectedProjectId
      || '',
  ).trim();

  useEffect(() => {
    if (id) setProjectId(id);
  }, [id, setProjectId]);

  const [rows, setRows] = useState<ProjectBoqItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const boq = await listProjectBoq(id);
      setRows(boq);
      setError('');
    } catch (err) {
      const raw = err instanceof Error ? err.message : 'Could not load project BOQ.';
      setError(
        /permission|insufficient/i.test(raw)
          ? 'You do not have access to this project’s BOQ. Sign in as the Engineer I assigned to this project (or Engineer IV), and confirm you are listed on the project.'
          : raw,
      );
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const totalAmount = useMemo(
    () => rows.filter((row) => row.active).reduce((sum, row) => sum + projectBoqAmount(row), 0),
    [rows],
  );

  const {
    page,
    setPage,
    pageItems,
    totalPages,
    from,
    to,
    total,
    pageSize,
  } = usePagination(rows, {
    resetKey: id,
  });

  const patch = (rowId: string, value: Partial<ProjectBoqItem>) => {
    setRows((current) => current.map((row) => (row.id === rowId ? { ...row, ...value } : row)));
  };

  const addRow = () => {
    setRows((current) => {
      const next = [...current, emptyRow(id)];
      setPage(Math.max(1, Math.ceil(next.length / pageSize)));
      return next;
    });
  };

  const selectPayItem = (rowId: string, item: PayItem | null) => {
    if (!item) return;
    // Copy master values into the project row; qty/cost remain project-specific.
    patch(rowId, {
      payItemId: item.id,
      payItemVersion: item.version,
      itemNo: item.itemNo,
      description: item.description,
      unit: item.unit,
    });
  };

  const save = async (row: ProjectBoqItem) => {
    if (!row.payItemId) {
      setError('Select a Pay Item before saving the BOQ row.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const saved = await saveProjectBoqItem(
        id,
        {
          payItemId: row.payItemId,
          programmedQty: row.programmedQty,
          revisedQty: row.revisedQty,
          unitPrice: row.unitPrice,
          weightPct: row.weightPct,
          active: row.active,
        },
        row.id.startsWith('new-') ? undefined : row.id,
      );
      setRows((current) => current.map((item) => (item.id === row.id ? saved : item)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save BOQ row.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="flex-1 overflow-y-auto">
      <div className="space-y-5 px-8 pb-10 pt-6">
        <PageHeader
          badge="Project · Pay Items"
          title="Project BOQ"
          description="Select Pay Items from the centralized Pay Item Master. Quantity, Unit Cost, Amount, and WT% stay project-specific."
          actions={
            <>
              <Link
                to="/projects/"
                className="shrink-0 rounded-lg border border-border px-2.5 py-1.5 text-[11px] font-semibold text-text-muted hover:bg-surface-muted"
              >
                Back to projects
              </Link>
              <button
                type="button"
                onClick={addRow}
                disabled={!id}
                className="shrink-0 rounded-lg bg-primary px-2.5 py-1.5 text-[11px] font-semibold text-white disabled:opacity-50"
              >
                + Add BOQ item
              </button>
            </>
          }
        />
        {!id ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            No project selected. Open Pay Items from the Projects page.
          </div>
        ) : null}
        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {error}
          </div>
        )}
        <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
            <div>
              <h2 className="text-lg font-semibold text-text">Project BOQ items</h2>
              <p className="mt-1 text-sm text-text-muted">
                Contract total:{' '}
                <strong className="text-text">₱{formatMoney(totalAmount)}</strong>
              </p>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1180px] text-left text-sm">
              <thead className="bg-surface-muted/60 text-[11px] uppercase tracking-wider text-text-muted">
                <tr className="border-b border-border">
                  <th className="px-5 py-3">Item No.</th>
                  <th className="px-5 py-3">Description</th>
                  <th className="px-5 py-3">Unit</th>
                  <th className="px-5 py-3">Qty</th>
                  <th className="px-5 py-3">Unit Cost</th>
                  <th className="px-5 py-3">Amount</th>
                  <th className="px-5 py-3">WT%</th>
                  <th className="px-5 py-3">Revised Qty</th>
                  <th className="px-5 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/80">
                {loading ? (
                  <tr>
                    <td colSpan={9} className="px-5 py-10 text-text-muted">
                      Loading BOQ…
                    </td>
                  </tr>
                ) : (
                  pageItems.map((row) => {
                    const amount = projectBoqAmount(row);
                    const autoWt =
                      totalAmount > 0 && row.active ? (amount / totalAmount) * 100 : 0;
                    const displayWt = row.weightPct != null ? row.weightPct : autoWt;
                    return (
                      <tr key={row.id} className="align-top hover:bg-surface-muted/40">
                        <td className="px-5 py-4">
                          <PayItemSelect
                            value={row.payItemId}
                            onChange={(selected) => selectPayItem(row.id, selected)}
                            fallbackLabel={row.itemNo || undefined}
                          />
                          {row.payItemId && (
                            <p className="mt-1 text-[10px] text-text-muted">v{row.payItemVersion}</p>
                          )}
                        </td>
                        <td className="px-5 py-4 text-text">
                          {row.description || 'Select a Pay Item'}
                        </td>
                        <td className="px-5 py-4 text-text-muted">{row.unit || '—'}</td>
                        <td className="px-5 py-4">
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={row.programmedQty || ''}
                            onChange={(event) =>
                              patch(row.id, {
                                programmedQty: Number(event.target.value) || 0,
                              })
                            }
                            className="w-28 rounded-lg border border-border bg-surface px-2 py-1.5 text-right"
                          />
                        </td>
                        <td className="px-5 py-4">
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={row.unitPrice || ''}
                            onChange={(event) =>
                              patch(row.id, { unitPrice: Number(event.target.value) || 0 })
                            }
                            className="w-28 rounded-lg border border-border bg-surface px-2 py-1.5 text-right"
                          />
                        </td>
                        <td className="px-5 py-4 text-right font-medium">₱{formatMoney(amount)}</td>
                        <td className="px-5 py-4">
                          <input
                            type="number"
                            min="0"
                            max="100"
                            step="0.0001"
                            value={
                              row.weightPct != null
                                ? row.weightPct
                                : displayWt
                                  ? Number(displayWt.toFixed(4))
                                  : ''
                            }
                            onChange={(event) =>
                              patch(row.id, {
                                weightPct:
                                  event.target.value === ''
                                    ? null
                                    : Number(event.target.value) || 0,
                              })
                            }
                            className="w-24 rounded-lg border border-border bg-surface px-2 py-1.5 text-right"
                            title="Leave blank to use amount-based weight %"
                          />
                        </td>
                        <td className="px-5 py-4">
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={row.revisedQty ?? ''}
                            onChange={(event) =>
                              patch(row.id, {
                                revisedQty:
                                  event.target.value === ''
                                    ? null
                                    : Number(event.target.value),
                              })
                            }
                            className="w-28 rounded-lg border border-border bg-surface px-2 py-1.5 text-right"
                          />
                        </td>
                        <td className="px-5 py-4 text-right">
                          <button
                            type="button"
                            disabled={saving}
                            onClick={() => void save(row)}
                            className="rounded-lg bg-primary-light px-3 py-1.5 text-xs font-semibold text-primary disabled:opacity-50"
                          >
                            Save
                          </button>
                          {!row.id.startsWith('new-') && (
                            <button
                              type="button"
                              onClick={() =>
                                void setProjectBoqActive(id, row.id, !row.active).then(load)
                              }
                              className="ml-2 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-text-muted"
                            >
                              {row.active ? 'Deactivate' : 'Activate'}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
                {!loading && rows.length === 0 && (
                  <tr>
                    <td colSpan={9} className="px-5 py-12 text-center text-sm text-text-muted">
                      No BOQ items assigned yet. Add a row and select an active Pay Item.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <Pagination
            page={page}
            totalPages={totalPages}
            total={total}
            from={from}
            to={to}
            pageSize={pageSize}
            onPageChange={setPage}
          />
        </div>
      </div>
    </main>
  );
}

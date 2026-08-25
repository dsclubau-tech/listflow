export type ActiveJobLeaseLike = {
  jobType: string;
  jobId: string;
  workerId: string;
  workerName: string;
  renewedAt: string;
};

export type WorkerWithActiveJobs = {
  workerId: string | null;
  workerName: string | null;
  workerRole: string;
  currentJobs: ActiveJobLeaseLike[];
};

export type ActiveJobWorkerAssignment = {
  jobType: string;
  jobId: string;
  workerId: string;
  workerName: string;
  workerRole: string;
  renewedAt: string;
};

export function getActiveJobAssignmentKey(jobType: string, jobId: string) {
  return `${jobType}:${jobId}`;
}

export function buildActiveJobAssignmentIndex(
  workers: WorkerWithActiveJobs[],
) {
  const assignments = new Map<string, ActiveJobWorkerAssignment>();

  for (const worker of workers) {
    for (const lease of worker.currentJobs) {
      const key = getActiveJobAssignmentKey(lease.jobType, lease.jobId);
      const existing = assignments.get(key);
      const existingRenewedAt = existing
        ? new Date(existing.renewedAt).getTime()
        : Number.NEGATIVE_INFINITY;
      const leaseRenewedAt = new Date(lease.renewedAt).getTime();

      if (existing && leaseRenewedAt <= existingRenewedAt) {
        continue;
      }

      assignments.set(key, {
        jobType: lease.jobType,
        jobId: lease.jobId,
        workerId: lease.workerId || worker.workerId || "unknown-worker",
        workerName:
          lease.workerName || worker.workerName || lease.workerId || "Worker",
        workerRole: worker.workerRole,
        renewedAt: lease.renewedAt,
      });
    }
  }

  return assignments;
}

export function getActiveJobAssignment(
  assignments: Map<string, ActiveJobWorkerAssignment>,
  jobType: string,
  jobId: string,
) {
  return assignments.get(getActiveJobAssignmentKey(jobType, jobId)) ?? null;
}

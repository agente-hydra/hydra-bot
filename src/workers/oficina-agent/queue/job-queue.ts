import { JobEntry, JobRequest, JobStatus } from '../types/index.js';
import * as crypto from 'crypto';

// Callback function type that will be injected to run the actual Playwright job
type JobExecutor = (job: JobEntry) => Promise<void>;

class JobQueue {
  private queue: JobEntry[] = [];
  private history: Map<string, JobEntry> = new Map();
  private isProcessing: boolean = false;
  private currentJob: JobEntry | null = null;
  private executor: JobExecutor | null = null;

  public setExecutor(executor: JobExecutor) {
    this.executor = executor;
  }

  public async addJob(request: JobRequest): Promise<JobEntry> {
    const job: JobEntry = {
      id: crypto.randomUUID(),
      request,
      status: 'queued',
      createdAt: Date.now()
    };
    this.queue.push(job);
    this.history.set(job.id, job);
    
    // Process async sem travar a thread
    setTimeout(() => this.processNext(), 0);
    
    return job;
  }

  public getJob(id: string): JobEntry | undefined {
    return this.history.get(id);
  }

  public cancelJob(id: string): boolean {
    const job = this.history.get(id);
    if (!job) return false;
    
    // Permite cancelar somente se estiver na fila aguardando
    if (job.status === 'queued') {
      job.status = 'cancelled';
      this.queue = this.queue.filter(j => j.id !== id);
      return true;
    }
    return false;
  }

  public getQueueSize(): number {
    return this.queue.length;
  }

  public getRunningJob(): string | null {
    return this.currentJob ? this.currentJob.id : null;
  }

  private async processNext() {
    if (this.isProcessing || this.queue.length === 0) return;
    
    this.isProcessing = true;
    this.currentJob = this.queue.shift() || null;
    
    if (!this.currentJob) {
       this.isProcessing = false;
       return;
    }
    
    this.currentJob.status = 'running';
    
    try {
      if (!this.executor) {
        throw new Error('No executor configured for the job queue.');
      }
      
      // Adiciona um timeout de segurança no wrapper, 
      // caso o Playwright não respeite seu próprio timeout.
      const timeoutPromise = new Promise((_, reject) => {
        const timeoutMs = 180000; // 3 minutos
        this.currentJob!.timeoutId = setTimeout(() => {
          reject(new Error('timeout'));
        }, timeoutMs);
      });

      await Promise.race([
        this.executor(this.currentJob),
        timeoutPromise
      ]);

      if (this.currentJob.status === 'running') {
        this.currentJob.status = 'completed';
      }

    } catch (err: any) {
      if (err.message === 'timeout') {
         this.currentJob.status = 'timeout';
         console.error(`[JobQueue] Timeout excedido para job ${this.currentJob.id}`);
      } else if (err.message === 'session_expired') {
         this.currentJob.status = 'session_expired';
      } else {
         this.currentJob.status = 'failed';
         console.error(`[JobQueue] Erro ao processar job ${this.currentJob.id}:`, err);
      }
    } finally {
       if (this.currentJob && this.currentJob.timeoutId) {
         clearTimeout(this.currentJob.timeoutId);
       }
       this.currentJob = null;
       this.isProcessing = false;
       // Dispara o próximo da fila
       setTimeout(() => this.processNext(), 0);
    }
  }
}

export const jobQueue = new JobQueue();

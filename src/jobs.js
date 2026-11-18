'use strict';

const { EventEmitter } = require('events');
const { randomId } = require('./util');

/**
 * Tâches longues (installation SteamCMD, téléchargement de plugins…).
 * Une seule à la fois ; la progression est diffusée en direct au navigateur.
 */
class Jobs extends EventEmitter {
  constructor() {
    super();
    this.current = null;
    this.last = null;
  }

  snapshot() {
    const j = this.current || this.last;
    if (!j) return null;
    const { cancelFn, ...rest } = j;
    return rest;
  }

  start(type, label, fn) {
    if (this.current) throw new Error(`Une tâche est déjà en cours : ${this.current.label}`);
    const job = {
      id: randomId(),
      type,
      label,
      status: 'running',
      progress: null,
      message: 'Préparation…',
      logs: [],
      startedAt: Date.now(),
      cancelFn: null,
      cancelled: false,
    };
    this.current = job;

    let lastEmit = 0;
    const emit = (force) => {
      const now = Date.now();
      if (force || now - lastEmit > 250) {
        lastEmit = now;
        this.emit('update', this.snapshot());
      }
    };

    const ctx = {
      progress: (progress, message) => {
        job.progress = progress == null ? null : Math.max(0, Math.min(100, progress));
        if (message) job.message = message;
        emit(false);
      },
      log: (line) => {
        job.logs.push(line);
        if (job.logs.length > 400) job.logs.shift();
        this.emit('log', line);
      },
      onCancel: (fn) => {
        job.cancelFn = fn;
      },
      get cancelled() {
        return job.cancelled;
      },
    };

    emit(true);
    Promise.resolve()
      .then(() => fn(ctx))
      .then(() => {
        job.status = 'done';
        job.progress = 100;
        job.message = 'Terminé';
      })
      .catch((e) => {
        job.status = job.cancelled ? 'cancelled' : 'error';
        job.message = job.cancelled ? 'Annulé' : e.message;
        ctx.log(`✖ ${job.message}`);
      })
      .finally(() => {
        job.finishedAt = Date.now();
        this.current = null;
        this.last = job;
        emit(true);
        this.emit('finished', job);
      });

    return this.snapshot();
  }

  cancel() {
    const job = this.current;
    if (!job) return false;
    job.cancelled = true;
    if (job.cancelFn) job.cancelFn();
    return true;
  }
}

module.exports = new Jobs();

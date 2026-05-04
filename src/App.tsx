/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useEffect, useRef, Component, ErrorInfo, ReactNode } from 'react';
import { 
  Calculator, 
  Stethoscope, 
  Clock, 
  Users, 
  DollarSign, 
  Settings, 
  ChevronDown, 
  ChevronUp,
  ChevronRight,
  Info,
  AlertCircle,
  TrendingUp,
  TrendingDown,
  Wallet,
  CheckCircle2,
  Edit,
  Edit3,
  Trash2,
  Save,
  FolderOpen,
  FileText,
  FilePlus,
  Plus,
  X,
  Calendar,
  LogIn,
  LogOut,
  ExternalLink,
  User as UserIcon,
  CheckCircle2 as CheckIcon,
  Archive,
  PlusCircle,
  MinusCircle,
  History,
  Download,
  Upload,
  RotateCcw,
  FileDown,
  AlertTriangle,
  Monitor,
  Lock,
  ShieldCheck,
  Check,
} from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { utils, writeFile } from 'xlsx';
import { motion, AnimatePresence } from 'motion/react';
import { 
  auth, 
  db, 
  signInWithGoogle, 
  logout, 
  onAuthStateChanged, 
  collection, 
  doc, 
  setDoc, 
  getDoc,
  getDocs,
  query,
  where,
  onSnapshot, 
  deleteDoc, 
  updateDoc, 
  writeBatch,
  handleFirestoreError, 
  OperationType,
  User
} from './firebase';

import { HELP_CONTENT } from './constants/helpContent';
import { useAuth } from './hooks/useAuth';

// --- Error Boundary ---

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      let errorMessage = "Algo salió mal.";
      try {
        const firestoreError = JSON.parse(this.state.error?.message || "{}");
        if (firestoreError.error) {
          errorMessage = `Error de base de datos: ${firestoreError.error}`;
        }
      } catch (e) {
        errorMessage = this.state.error?.message || errorMessage;
      }

      return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
          <div className="bg-white p-8 rounded-3xl shadow-xl max-w-md w-full text-center space-y-4">
            <div className="w-16 h-16 bg-rose-100 text-rose-600 rounded-full flex items-center justify-center mx-auto">
              <AlertCircle className="w-8 h-8" />
            </div>
            <h1 className="text-xl font-bold text-slate-900">¡Ups! Ha ocurrido un error</h1>
            <p className="text-slate-600 text-sm">{errorMessage}</p>
            <button 
              onClick={() => window.location.reload()}
              className="w-full py-3 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 transition-all"
            >
              Recargar aplicación
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

// --- Types ---

interface Deduction {
  id: string;
  userId: string;
  concept: string;
  amount: number;
  periodId?: string;
  applied?: boolean;
}

interface BillingPeriod {
  id: string;
  userId: string;
  name: string;
  startDate: string;
  endDate: string;
  status: 'active' | 'archived';
  createdAt: string;
  extraThreshold?: number;         // Límite de horas para activar extras
  totalGross?: number;             // gross (solo turnos)
  totalGrossWithBenefits?: number; // totalGross del useMemo (con prima, vacaciones)
  totalDeductions?: number;
  net?: number;
  primaProporcional?: number;
  vacacionesProporcional?: number;
  cesantiasProporcional?: number;
  interesesCesantias?: number;
  rates?: Rates;
}

interface Trisemana {
  id: string;
  userId: string;
  name: string;
  startDate: string;
  endDate: string;
  maxHours: number;
  status: 'active' | 'archived';
  createdAt: string;
}

interface SavedCalculation {
  id: string;
  name: string;
  timestamp: string;
  records: ShiftRecord[];
  rates: Rates;
  additionalDeductions: Deduction[];
}

interface Rates {
  base: {
    consultation: number; // 23338
    service: number;      // 10825
    ava: number;          // 37709
    virtual: number;      // 37709
  };
  surcharges: {
    night: number;        // 0.35
    holidayDay: number;   // 0.80
    holidayNight: number; // 1.15
    extraDay: number;     // 0.25
    extraNight: number;   // 0.75
    extraHolidayDay: number;
    extraHolidayNight: number;
  };
  hourly: {
    day: number;
    night: number;
    holidayDay: number;
    holidayNight: number;
    extraDay: number;
    extraNight: number;
    extraHolidayDay: number;
    extraHolidayNight: number;
  };
  ava: {
    day: number;
    night: number;
    holidayDay: number;
    holidayNight: number;
    extraDay: number;
    extraNight: number;
    extraHolidayDay: number;
    extraHolidayNight: number;
  };
  patient: {
    day: number;
    night: number;
    holidayDay: number;
    holidayNight: number;
  };
  payroll: {
    uvtValue: number;
    dependents: boolean; // 10% of gross or 32 UVT
    prepagada: number; // Max 16 UVT
    pensionVoluntaria: number; // Max 30% of income or 3800 UVT/year
    interesesVivienda: number; // Max 100 UVT
    avgBilling12Months: number; // For Vacations proportional
    avgBilling6Months: number;  // For Prima proportional
    billingCutoffDay: number;   // Day of the month for billing cutoff
    nightShiftStart: number;    // Hour when night shift starts (e.g., 19 for 7 PM)
    vacationLastResetDate: string | null; // ISO date of last vacation reset
    primaLastResetDate: string | null;    // ISO date of last prima reset
    ibcMinimo: boolean;         // If true, IBC is capped at SMMLV if gross > SMMLV
    jobTitle: string;
    usePrepagada: boolean;
    usePensionVoluntaria: boolean;
    useInteresesVivienda: boolean;
    useManualRetefuente: boolean;
    manualRetefuentePct: number;
  };
}

interface ShiftInput {
  date: string;
  startTime: string;
  endTime: string;
  isHolidayStart: boolean;
  isHolidayEnd: boolean;
  isAVAShift: boolean;
  isVirtualShift: boolean;
  isExtraShift: boolean;
  isAdditionalShift: boolean;
  extraHoursType: 'consultation' | 'avaVirtual';
}

interface Quantities {
  hours: {
    day: number;
    night: number;
    holidayDay: number;
    holidayNight: number;
    extraDay: number;
    extraNight: number;
    extraHolidayDay: number;
    extraHolidayNight: number;
  };
  ava: {
    day: number;
    night: number;
    holidayDay: number;
    holidayNight: number;
    extraDay: number;
    extraNight: number;
    extraHolidayDay: number;
    extraHolidayNight: number;
  };
  patients: {
    day: number;
    night: number;
    holidayDay: number;
    holidayNight: number;
  };
  applyPatients: boolean;
}

interface ShiftRecord {
  id: string;
  userId: string;
  periodId?: string;
  date: string;
  startTime: string;
  endTime: string;
  hours: Quantities['hours'];
  ava: Quantities['ava'];
  patients: Quantities['patients'];
  applyPatients: boolean;
  isDefinitive: boolean;
  isExtraShift: boolean;
  isAdditionalShift: boolean;
  isHolidayStart: boolean;
  isHolidayEnd: boolean;
  isAVAShift: boolean;
  isVirtualShift: boolean;
  extraHoursType?: 'consultation' | 'avaVirtual';
  trisemanaId?: string | null;
}

// --- Constants ---

const SMMLV_2026 = 1750905;

// Recargos de Ley Colombia 2026 (No modificables)
const SURCHARGES_2026 = {
  night: 0.35,              // Recargo Nocturno (35%)
  holidayDay: 0.75,         // Recargo Dominical/Festivo Diurno (75%)
  holidayNight: 1.10,       // Recargo Dominical/Festivo Nocturno (75% + 35% = 110%)
  extraDay: 0.25,           // Extra Diurna (25%)
  extraNight: 0.75,         // Extra Nocturna (75%)
  extraHolidayDay: 1.00,    // Extra Festiva Diurna (100%)
  extraHolidayNight: 1.50   // Extra Festiva Nocturna (150%)
};

const DEFAULT_RATES: Rates = {
  base: {
    consultation: 23338,
    service: 10825,
    ava: 37709,
    virtual: 37709,
  },
  surcharges: { ...SURCHARGES_2026 },
  hourly: {
    day: 23338,
    night: 31506,
    holidayDay: 40842,
    holidayNight: 49010,
    extraDay: 29173,
    extraNight: 40842,
    extraHolidayDay: 46676,
    extraHolidayNight: 58345,
  },
  ava: {
    day: 37709,
    night: 50907,
    holidayDay: 65991,
    holidayNight: 79189,
    extraDay: 47136,
    extraNight: 65991,
    extraHolidayDay: 75418,
    extraHolidayNight: 94273,
  },
  patient: {
    day: 10825,
    night: 14613,
    holidayDay: 19485,
    holidayNight: 23273,
  },
  payroll: {
    uvtValue: 49794,
    dependents: false,
    prepagada: 0,
    pensionVoluntaria: 0,
    interesesVivienda: 0,
    avgBilling12Months: 0,
    avgBilling6Months: 0,
    billingCutoffDay: 29,
    nightShiftStart: 19,
    vacationLastResetDate: null,
    primaLastResetDate: null,
    ibcMinimo: false,
    jobTitle: 'MEDICO CONSULTA 2 MED',
    usePrepagada: true,
    usePensionVoluntaria: true,
    useInteresesVivienda: true,
    useManualRetefuente: false,
    manualRetefuentePct: 0,
  }
};

// --- Helper Functions ---

const sortRecords = (records: ShiftRecord[]) => {
  return [...records].sort((a, b) => {
    const dateCompare = a.date.localeCompare(b.date);
    if (dateCompare !== 0) return dateCompare;
    return a.startTime.localeCompare(b.startTime);
  });
};

const formatCurrency = (value: number) => {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 2,
  }).format(value);
};

// Utility to ensure a rates object is fully populated and up-to-date with 2026 surcharges
const normalizeRates = (rates: any): Rates => {
  return {
    ...DEFAULT_RATES,
    ...rates,
    base: { 
      ...DEFAULT_RATES.base, 
      ...(rates?.base || {}) 
    },
    surcharges: { ...SURCHARGES_2026 }, // Always enforce current legal surcharges
    hourly: { 
      ...DEFAULT_RATES.hourly, 
      ...(rates?.hourly || {}) 
    },
    ava: { 
      ...DEFAULT_RATES.ava, 
      ...(rates?.ava || {}) 
    },
    patient: { 
      ...DEFAULT_RATES.patient, 
      ...(rates?.patient || {}) 
    },
    payroll: { 
      ...DEFAULT_RATES.payroll, 
      ...(rates?.payroll || {}) 
    }
  };
};

// --- Main Application Component ---
interface ShiftDistribution {
  ord: { day: number; night: number; holidayDay: number; holidayNight: number };
  extra: { day: number; night: number; holidayDay: number; holidayNight: number };
}

const calculateShiftValue = (record: ShiftRecord, rates: Rates) => {
  const r = normalizeRates(rates);
  const h = r.hourly;
  const a = r.ava;
  const p = r.patient;

  const hours = record.hours || { day: 0, night: 0, holidayDay: 0, holidayNight: 0, extraDay: 0, extraNight: 0, extraHolidayDay: 0, extraHolidayNight: 0 };
  const ava = record.ava || { day: 0, night: 0, holidayDay: 0, holidayNight: 0, extraDay: 0, extraNight: 0, extraHolidayDay: 0, extraHolidayNight: 0 };
  const patients = record.patients || { day: 0, night: 0, holidayDay: 0, holidayNight: 0 };

  let basePart = 0;
  let servicePart = 0;
  let avaPart = 0;

  // 1. Service Part
  if (record.applyPatients) {
    servicePart = (patients.day * p.day) + 
                  (patients.night * p.night) + 
                  (patients.holidayDay * p.holidayDay) + 
                  (patients.holidayNight * p.holidayNight);
  } else {
    // Hourly service applies to Consultation hours and optionally AVA if specified
    const isMainAlt = record.isAVAShift || record.isVirtualShift;
    const extraType = record.extraHoursType || (isMainAlt ? 'avaVirtual' : 'consultation');
    
    // Hourly Productive (Consultation records or records marked as Hourly)
    // We sum all Consultation hours (reg+extra) and AVA extras if they are Consultation type
    const regConsTotal = hours.day + hours.night + hours.holidayDay + hours.holidayNight;
    const extConsTotal = hours.extraDay + hours.extraNight + hours.extraHolidayDay + hours.extraHolidayNight;
    
    servicePart = ((hours.day + hours.extraDay) * p.day) + 
                  ((hours.night + hours.extraNight) * p.night) + 
                  ((hours.holidayDay + hours.extraHolidayDay) * p.holidayDay) + 
                  ((hours.holidayNight + hours.extraHolidayNight) * p.holidayNight);
  }

  // 2. Base Part (Consultation)
  basePart = (hours.day * h.day) +
             (hours.night * h.night) +
             (hours.holidayDay * h.holidayDay) +
             (hours.holidayNight * h.holidayNight) +
             (hours.extraDay * h.extraDay) +
             (hours.extraNight * h.extraNight) +
             (hours.extraHolidayDay * h.extraHolidayDay) +
             (hours.extraHolidayNight * h.extraHolidayNight);

  // 3. AVA Part
  avaPart = (ava.day * a.day) +
            (ava.night * a.night) +
            (ava.holidayDay * a.holidayDay) +
            (ava.holidayNight * a.holidayNight) +
            (ava.extraDay * a.extraDay) +
            (ava.extraNight * a.extraNight) +
            (ava.extraHolidayDay * a.extraHolidayDay) +
            (ava.extraHolidayNight * a.extraHolidayNight);

  return { base: basePart, service: servicePart, extraSurcharge: 0, avaVirtual: avaPart };
};

// --- Pure Calculation Logic (Correction 2 & 4) ---
const calculateShiftDistribution = (s: { startTime: string, endTime: string, isHolidayStart: boolean, isHolidayEnd: boolean }, r: Rates, threshold: number = 0) => {
  // Use normalized rates to avoid undefined property access
  const rates = normalizeRates(r);
  const [startH, startM] = s.startTime.split(':').map(Number);
  const [endH, endM] = s.endTime.split(':').map(Number);

  const startTotal = startH * 60 + startM;
  let endTotal = endH * 60 + endM;
  if (endTotal <= startTotal) endTotal += 24 * 60; // turno cruza medianoche

  const nightStart = rates.payroll.nightShiftStart * 60; // en minutos
  const dayStart = 6 * 60;

  const calculateForRange = (rangeStart: number, rangeEnd: number) => {
    let mD = 0, mN = 0, mDF = 0, mNF = 0;
    const addBlockRange = (from: number, to: number, isHoliday: boolean, isDay: boolean) => {
      const overlap = Math.max(0, Math.min(to, rangeEnd) - Math.max(from, rangeStart));
      if (overlap <= 0) return;
      if (isDay && !isHoliday) mD += overlap;
      else if (!isDay && !isHoliday) mN += overlap;
      else if (isDay && isHoliday) mDF += overlap;
      else mNF += overlap;
    };

    // Primer día (minutos 0..1440)
    const h = s.isHolidayStart;
    addBlockRange(0,        dayStart,   h, false); // 00:00-06:00 nocturno
    addBlockRange(dayStart, nightStart, h, true);  // 06:00-nightStart diurno
    addBlockRange(nightStart, 1440,     h, false); // nightStart-24:00 nocturno

    // Segundo día, si el turno cruza medianoche (minutos 1440..2880)
    if (rangeEnd > 1440) {
      const h2 = s.isHolidayEnd;
      addBlockRange(1440,        1440 + dayStart,   h2, false);
      addBlockRange(1440 + dayStart, 1440 + nightStart, h2, true);
      addBlockRange(1440 + nightStart, 2880,          h2, false);
    }
    return { mD, mN, mDF, mNF };
  };

  const ordEnd = threshold > 0 ? Math.min(endTotal, startTotal + threshold * 60) : startTotal;
  const ord = calculateForRange(startTotal, ordEnd);
  const extra = (threshold >= 0 && endTotal > ordEnd) ? calculateForRange(ordEnd, endTotal) : { mD: 0, mN: 0, mDF: 0, mNF: 0 };

  const round2 = (n: number) => Math.round(n * 100) / 100;
  return {
    ord: {
      day:         round2(ord.mD / 60),
      night:       round2(ord.mN / 60),
      holidayDay:  round2(ord.mDF / 60),
      holidayNight: round2(ord.mNF / 60),
    },
    extra: {
      day:         round2(extra.mD / 60),
      night:       round2(extra.mN / 60),
      holidayDay:  round2(extra.mDF / 60),
      holidayNight: round2(extra.mNF / 60),
    }
  };
};

const calculatePeriodTotals = (
  records: ShiftRecord[],
  rates: Rates,
  additionalDeductions: Deduction[],
  periods: BillingPeriod[],
  selectedPeriodId: string | null,
  allRecords: ShiftRecord[] = [],
  trisemanas: Trisemana[] = []
) => {
  // Use normalized rates to avoid undefined property access
  const r = normalizeRates(rates);
  let totalH = 0;
  let totalP = 0;
  let totalAVA = 0;

  const hoursBreakdown = { 
    day: 0, night: 0, holidayDay: 0, holidayNight: 0,
    extraDay: 0, extraNight: 0, extraHolidayDay: 0, extraHolidayNight: 0
  };
  const avaVirtualBreakdown = { 
    day: 0, night: 0, holidayDay: 0, holidayNight: 0,
    extraDay: 0, extraNight: 0, extraHolidayDay: 0, extraHolidayNight: 0
  };
  const patientsBreakdown = { day: 0, night: 0, holidayDay: 0, holidayNight: 0 };
  const monthlyHours: { [key: string]: number } = {};
  const trisemanaBreakdown: { [trisemanaId: string]: { name: string, ord: number, extra: number } } = {};

  // Components for the new additive logic
  const components = {
    base: 0,
    service: 0,
    extraSurcharge: 0,
    avaVirtual: 0
  };

  // 1. Pre-calculate distributions for all records in relevant Trisemanas
  // This ensures cumulative hours track correctly across billing periods
  const recordDistributions: { [recordId: string]: any } = {};
  
  // Find all trisemanas that overlap with the current period or have records in it
  const relevantTrisemanas = trisemanas
    .filter(t => {
      const p = periods.find(per => per.id === selectedPeriodId);
      const isOverlapping = p ? (
        (t.startDate >= p.startDate && t.startDate <= p.endDate) || 
        (t.endDate >= p.startDate && t.endDate <= p.endDate) ||
        (t.startDate <= p.startDate && t.endDate >= p.endDate)
      ) : false;
      
      const hasRecords = records.some(r => r.trisemanaId === t.id || (!r.trisemanaId && r.date >= t.startDate && r.date <= t.endDate));
      return isOverlapping || hasRecords;
    })
    .sort((a, b) => a.startDate.localeCompare(b.startDate));

  relevantTrisemanas.forEach(trisemana => {
    // Get ALL records in this trisemana across all time/periods
    const trisemanaRecords = allRecords
      .filter(r => r.trisemanaId === trisemana.id || (!r.trisemanaId && r.date >= trisemana.startDate && r.date <= trisemana.endDate))
      .sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));
    
    let cumulative = 0;
    trisemanaRecords.forEach(r => {
      const remainingForShift = Math.max(0, trisemana.maxHours - cumulative);
      const dist = calculateShiftDistribution({
        startTime: r.startTime,
        endTime: r.endTime,
        isHolidayStart: r.isHolidayStart || false,
        isHolidayEnd: r.isHolidayEnd || false
      }, rates, remainingForShift);
      
      const shiftHours = (dist.ord.day + dist.ord.night + dist.ord.holidayDay + dist.ord.holidayNight) +
                         (dist.extra.day + dist.extra.night + dist.extra.holidayDay + dist.extra.holidayNight);
      
      // Calculate manual additional hours distribution
      const totalRecordOrd = (dist.ord.day + dist.ord.night + dist.ord.holidayDay + dist.ord.holidayNight);
      const totalRecordExtra = (dist.extra.day + dist.extra.night + dist.extra.holidayDay + dist.extra.holidayNight);

      const crossedThreshold = cumulative < trisemana.maxHours && (cumulative + totalRecordOrd) >= trisemana.maxHours;
      const alreadyOver = cumulative >= trisemana.maxHours;

      recordDistributions[r.id] = { 
        ...dist, 
        crossedThreshold, 
        alreadyOver,
        cumulativeBefore: cumulative,
        cumulativeAfter: cumulative + totalRecordOrd
      };
      
      // Only add to breakdown if the record is in the current period being calculated
      if (records.some(currR => currR.id === r.id)) {
        if (!trisemanaBreakdown[trisemana.id]) {
          trisemanaBreakdown[trisemana.id] = { name: trisemana.name, ord: 0, extra: 0 };
        }
        trisemanaBreakdown[trisemana.id].ord += totalRecordOrd;
        trisemanaBreakdown[trisemana.id].extra += totalRecordExtra;
      }

      // Both regular shift hours and manual additional hours (up to threshold) count towards trisemana
      cumulative += totalRecordOrd;
    });
  });

  // 2. Standard period threshold logic (fallback for records without Trisemana)
  const activePeriod = periods.find(p => p.id === selectedPeriodId);
  const periodThreshold = activePeriod?.extraThreshold || 0;
  let periodCumulativeHours = 0;

  // Sort records chronologically to apply threshold correctly
  const sortedRecords = [...records].sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));

  sortedRecords.forEach(record => {
    // Use pre-calculated trisemana distribution if available
    let dist = recordDistributions[record.id];
    
    if (!dist) {
      // Fallback: Standard period threshold logic
      const remainingToThreshold = periodThreshold > 0 ? Math.max(0, periodThreshold - periodCumulativeHours) : 999999;
      dist = calculateShiftDistribution({
        startTime: record.startTime,
        endTime: record.endTime,
        isHolidayStart: record.isHolidayStart || false,
        isHolidayEnd: record.isHolidayEnd || false
      }, rates, remainingToThreshold);
      
      periodCumulativeHours += (dist.ord.day + dist.ord.night + dist.ord.holidayDay + dist.ord.holidayNight);
      
      // Store it so it's available for the UI
      recordDistributions[record.id] = dist;
    }

    // Use directly stored values for breakdown to honor manual edits
    const hField = record.hours || { day: 0, night: 0, holidayDay: 0, holidayNight: 0, extraDay: 0, extraNight: 0, extraHolidayDay: 0, extraHolidayNight: 0 };
    const aField = record.ava || { day: 0, night: 0, holidayDay: 0, holidayNight: 0, extraDay: 0, extraNight: 0, extraHolidayDay: 0, extraHolidayNight: 0 };
    const pField = record.patients || { day: 0, night: 0, holidayDay: 0, holidayNight: 0 };

    // Update breakdowns
    hoursBreakdown.day += hField.day;
    hoursBreakdown.night += hField.night;
    hoursBreakdown.holidayDay += hField.holidayDay;
    hoursBreakdown.holidayNight += hField.holidayNight;
    hoursBreakdown.extraDay += hField.extraDay;
    hoursBreakdown.extraNight += hField.extraNight;
    hoursBreakdown.extraHolidayDay += hField.extraHolidayDay;
    hoursBreakdown.extraHolidayNight += hField.extraHolidayNight;

    avaVirtualBreakdown.day += aField.day;
    avaVirtualBreakdown.night += aField.night;
    avaVirtualBreakdown.holidayDay += aField.holidayDay;
    avaVirtualBreakdown.holidayNight += aField.holidayNight;
    avaVirtualBreakdown.extraDay += aField.extraDay;
    avaVirtualBreakdown.extraNight += aField.extraNight;
    avaVirtualBreakdown.extraHolidayDay += aField.extraHolidayDay;
    avaVirtualBreakdown.extraHolidayNight += aField.extraHolidayNight;

    // Patients Breakdown
    patientsBreakdown.day += pField.day;
    patientsBreakdown.night += pField.night;
    patientsBreakdown.holidayDay += pField.holidayDay;
    patientsBreakdown.holidayNight += pField.holidayNight;

    // Add hourly productive service if applicable
    if (!record.applyPatients) {
      patientsBreakdown.day += hField.day + hField.extraDay;
      patientsBreakdown.night += hField.night + hField.extraNight;
      patientsBreakdown.holidayDay += hField.holidayDay + hField.extraHolidayDay;
      patientsBreakdown.holidayNight += hField.holidayNight + hField.extraHolidayNight;
    }

    // Calculation using the refined function
    const shiftValue = calculateShiftValue(record, rates);
    components.base += shiftValue.base;
    components.service += shiftValue.service;
    components.extraSurcharge += shiftValue.extraSurcharge;
    components.avaVirtual += shiftValue.avaVirtual;

    const rDate = new Date(record.date + 'T00:00:00');
    const monthName = rDate.toLocaleString('es-ES', { month: 'long', year: 'numeric' });
    const recordTotalHours = (hField.day + hField.night + hField.holidayDay + hField.holidayNight + hField.extraDay + hField.extraNight + hField.extraHolidayDay + hField.extraHolidayNight) +
                             (aField.day + aField.night + aField.holidayDay + aField.holidayNight + aField.extraDay + aField.extraNight + aField.extraHolidayDay + aField.extraHolidayNight);
    
    monthlyHours[monthName] = (monthlyHours[monthName] || 0) + recordTotalHours;
  });

  const hoursValues = {
    day: hoursBreakdown.day * r.hourly.day,
    night: hoursBreakdown.night * r.hourly.night,
    holidayDay: hoursBreakdown.holidayDay * r.hourly.holidayDay,
    holidayNight: hoursBreakdown.holidayNight * r.hourly.holidayNight,
    extraDay: hoursBreakdown.extraDay * r.hourly.extraDay,
    extraNight: hoursBreakdown.extraNight * r.hourly.extraNight,
    extraHolidayDay: hoursBreakdown.extraHolidayDay * r.hourly.extraHolidayDay,
    extraHolidayNight: hoursBreakdown.extraHolidayNight * r.hourly.extraHolidayNight,
  };

  const avaVirtualValues = {
    day: avaVirtualBreakdown.day * r.ava.day,
    night: avaVirtualBreakdown.night * r.ava.night,
    holidayDay: avaVirtualBreakdown.holidayDay * r.ava.holidayDay,
    holidayNight: avaVirtualBreakdown.holidayNight * r.ava.holidayNight,
    extraDay: avaVirtualBreakdown.extraDay * r.ava.extraDay,
    extraNight: avaVirtualBreakdown.extraNight * r.ava.extraNight,
    extraHolidayDay: avaVirtualBreakdown.extraHolidayDay * r.ava.extraHolidayDay,
    extraHolidayNight: avaVirtualBreakdown.extraHolidayNight * r.ava.extraHolidayNight,
  };

  const patientsValues = {
    day: patientsBreakdown.day * rates.patient.day,
    night: patientsBreakdown.night * rates.patient.night,
    holidayDay: patientsBreakdown.holidayDay * rates.patient.holidayDay,
    holidayNight: patientsBreakdown.holidayNight * rates.patient.holidayNight,
  };

  totalH = components.base + components.extraSurcharge;
  totalAVA = components.avaVirtual;
  totalP = components.service; 

  const gross = components.base + components.extraSurcharge + components.service + components.avaVirtual;
  const totalRegularHours = hoursBreakdown.day + hoursBreakdown.night + hoursBreakdown.holidayDay + hoursBreakdown.holidayNight +
                           avaVirtualBreakdown.day + avaVirtualBreakdown.night + avaVirtualBreakdown.holidayDay + avaVirtualBreakdown.holidayNight;
  const totalExtraHours = hoursBreakdown.extraDay + hoursBreakdown.extraNight + hoursBreakdown.extraHolidayDay + hoursBreakdown.extraHolidayNight +
                         avaVirtualBreakdown.extraDay + avaVirtualBreakdown.extraNight + avaVirtualBreakdown.extraHolidayDay + avaVirtualBreakdown.extraHolidayNight;
  const totalAllHours = totalRegularHours + totalExtraHours;

  let ibc = gross > 0 ? Math.max(Math.min(gross, SMMLV_2026 * 25), SMMLV_2026) : 0;
  
  if (rates.payroll.ibcMinimo && gross > SMMLV_2026) {
    ibc = SMMLV_2026;
  }

  const health = ibc * 0.04;
  const pension = ibc * 0.04;
  const arl = ibc * 0.00522;
  const caja = ibc * 0.04;
  
  let fsp = 0;
  if (ibc >= SMMLV_2026 * 4) {
    if (ibc < SMMLV_2026 * 16) fsp = ibc * 0.01;
    else if (ibc < SMMLV_2026 * 17) fsp = ibc * 0.012;
    else if (ibc < SMMLV_2026 * 18) fsp = ibc * 0.014;
    else if (ibc < SMMLV_2026 * 19) fsp = ibc * 0.016;
    else if (ibc < SMMLV_2026 * 20) fsp = ibc * 0.018;
    else fsp = ibc * 0.02;
  }

  const sumAdditionalDeductions = additionalDeductions
    .filter(d => d.applied !== false)
    .reduce((sum, d) => sum + d.amount, 0);
  
  const legalDeductions = health + pension + fsp; // ARL is paid by employer in Colombia for employees

  // --- Retefuente Calculation (Colombian Tax - Art 383) ---
  const uvtValue = r.payroll.uvtValue;
  const netIncome = gross - legalDeductions;
  
  // 1. Deducciones (Dependientes, Prepagada, Intereses Vivienda, Pensión Voluntaria)
  const dedDependents = r.payroll.dependents ? Math.min(gross * 0.1, 32 * uvtValue) : 0;
  const dedPrepagada = r.payroll.usePrepagada ? Math.min(r.payroll.prepagada, 16 * uvtValue) : 0;
  const dedInteresesVivienda = r.payroll.useInteresesVivienda ? Math.min(r.payroll.interesesVivienda, 100 * uvtValue) : 0;
  // Pensión voluntaria is capped at 30% of gross and a yearly limit of 3800 UVT (approx 316.67 UVT monthly)
  const dedPensionVol = r.payroll.usePensionVoluntaria ? Math.min(r.payroll.pensionVoluntaria, gross * 0.3, (3800 * uvtValue) / 12) : 0;
  
  const totalDeductionsBeforeExempt = dedDependents + dedPrepagada + dedInteresesVivienda + dedPensionVol;
  
  // 2. Renta Exenta del 25% (Art 206 Num 10)
  // Se calcula sobre (Ingreso Neto - Deducciones)
  const baseForExempt25 = Math.max(0, netIncome - totalDeductionsBeforeExempt);
  // Capped at 790 UVT per year (approx 65.83 UVT monthly)
  const exempt25 = Math.min(baseForExempt25 * 0.25, (790 * uvtValue) / 12);
  
  const totalDeductionsAndExemptions = totalDeductionsBeforeExempt + exempt25;
  
  // 3. Limitación del 40% (Art 336)
  // La suma de deducciones y rentas exentas no puede superar el 40% del ingreso neto
  const cap40Percent = netIncome * 0.40;
  const finalDeductionsAndExemptions = Math.min(totalDeductionsAndExemptions, cap40Percent);
  
  const baseGravableFinal = Math.max(0, netIncome - finalDeductionsAndExemptions);
  const baseUVT = baseGravableFinal / uvtValue;
  
  let retefuente = 0;
  if (r.payroll.useManualRetefuente) {
    retefuente = gross * (r.payroll.manualRetefuentePct / 100);
  } else {
    // Tabla Retefuente Art. 383
    if (baseUVT <= 95) {
      retefuente = 0;
    } else if (baseUVT <= 150) {
      retefuente = (baseUVT - 95) * 0.19 * uvtValue;
    } else if (baseUVT <= 360) {
      retefuente = ((baseUVT - 150) * 0.28 + 10) * uvtValue;
    } else if (baseUVT <= 640) {
      retefuente = ((baseUVT - 360) * 0.33 + 69) * uvtValue;
    } else if (baseUVT <= 945) {
      retefuente = ((baseUVT - 640) * 0.35 + 162) * uvtValue;
    } else if (baseUVT <= 2300) {
      retefuente = ((baseUVT - 945) * 0.37 + 268) * uvtValue;
    } else {
      retefuente = ((baseUVT - 2300) * 0.39 + 770) * uvtValue;
    }
  }

  // --- Proportional Calculations based on Period History ---
  const currentPeriod = periods.find(p => p.id === selectedPeriodId);
  const otherPeriods = periods.filter(p => {
    if (p.id === selectedPeriodId) return false;
    if (currentPeriod) {
      return p.endDate < currentPeriod.startDate;
    }
    // Fallback if no period selected (shouldn't happen in calculatePeriodTotals for a period)
    return p.endDate < (periods.find(per => per.status === 'active')?.startDate || '');
  });
  const sortedOthers = [...otherPeriods].sort((a, b) => b.endDate.localeCompare(a.endDate));
  
  // Average 6 Months (Semester Reset for Primas) - Excluding current month as requested
  const primaResetDate = rates.payroll.primaLastResetDate;
  const primaOthers = sortedOthers.filter(p => {
    if (!primaResetDate) return true;
    return p.startDate >= primaResetDate;
  });
  const last6OthersPrima = primaOthers.slice(0, 6);
  const count6Prima = last6OthersPrima.length;
  const total6Prima = last6OthersPrima.reduce((sum, p) => sum + (p.totalGross || 0), 0);
  const avg6PrimaFromHistory = count6Prima > 0 ? total6Prima / count6Prima : 0;
  // Use config as fallback if history is empty
  const avg6Prima = avg6PrimaFromHistory > 0 ? avg6PrimaFromHistory : (rates.payroll.avgBilling6Months || 0);
  
  // Average for proportional calculation (includes current)
  const count6Proportional = last6OthersPrima.slice(0, 5).length + (selectedPeriodId ? 1 : 0);
  const total6Proportional = last6OthersPrima.slice(0, 5).reduce((sum, p) => sum + (p.totalGross || 0), 0) + (selectedPeriodId ? gross : 0);
  const avg6ProportionalFromHistory = count6Proportional > 0 ? total6Proportional / count6Proportional : 0;
  const avg6Proportional = avg6ProportionalFromHistory > 0 ? avg6ProportionalFromHistory : (rates.payroll.avgBilling6Months || 0);
  
  const primaProporcional = avg6Proportional / 12;
  const primaSemestral = avg6Prima * 0.5; // Final total for 6 months
  const cesantiasProporcional = avg6Proportional / 12;
  const interesesCesantias = cesantiasProporcional * 0.12;

  // Average 12 Months (Manual Reset for Vacations)
  const vacationResetDate = rates.payroll.vacationLastResetDate;
  const vacationOthers = sortedOthers.filter(p => {
    if (!vacationResetDate) return true;
    return p.startDate >= vacationResetDate;
  });
  const last11Others = vacationOthers.slice(0, 11);
  const count12 = last11Others.length + (selectedPeriodId ? 1 : 0);
  const total12 = last11Others.reduce((sum, p) => sum + (p.totalGross || 0), 0) + (selectedPeriodId ? gross : 0);
  const avg12FromHistory = count12 > 0 ? total12 / count12 : 0;
  const avg12 = avg12FromHistory > 0 ? avg12FromHistory : (rates.payroll.avgBilling12Months || 0);
  const vacacionesProporcional = avg12 / 24;
  
  const totalDeductions = legalDeductions + sumAdditionalDeductions + retefuente;
  const totalGrossWithBenefits = gross + primaProporcional + cesantiasProporcional + interesesCesantias + vacacionesProporcional;
  const net = totalGrossWithBenefits - totalDeductions;
  const netCash = gross - totalDeductions;

  const effectiveDeductionRate = totalGrossWithBenefits > 0 ? totalDeductions / totalGrossWithBenefits : 0;

  return {
    gross,
    totalPatrimonial: totalGrossWithBenefits,
    health,
    pension,
    arl,
    caja,
    fsp,
    additionalDeductions: sumAdditionalDeductions,
    totalDeductions,
    net,
    netCash,
    primaProporcional,
    primaSemestral,
    cesantiasProporcional,
    interesesCesantias,
    vacacionesProporcional,
    ibc,
    totalMonthlyHours: hoursBreakdown.day + hoursBreakdown.night + hoursBreakdown.holidayDay + hoursBreakdown.holidayNight +
                       hoursBreakdown.extraDay + hoursBreakdown.extraNight + hoursBreakdown.extraHolidayDay + hoursBreakdown.extraHolidayNight,
    totalMonthlyAVA: avaVirtualBreakdown.day + avaVirtualBreakdown.night + avaVirtualBreakdown.holidayDay + avaVirtualBreakdown.holidayNight +
                     avaVirtualBreakdown.extraDay + avaVirtualBreakdown.extraNight + avaVirtualBreakdown.extraHolidayDay + avaVirtualBreakdown.extraHolidayNight,
    totalAccumulatedHours: (hoursBreakdown.day + hoursBreakdown.night + hoursBreakdown.holidayDay + hoursBreakdown.holidayNight +
                            hoursBreakdown.extraDay + hoursBreakdown.extraNight + hoursBreakdown.extraHolidayDay + hoursBreakdown.extraHolidayNight) + 
                           (avaVirtualBreakdown.day + avaVirtualBreakdown.night + avaVirtualBreakdown.holidayDay + avaVirtualBreakdown.holidayNight +
                            avaVirtualBreakdown.extraDay + avaVirtualBreakdown.extraNight + avaVirtualBreakdown.extraHolidayDay + avaVirtualBreakdown.extraHolidayNight),
    totalRegularHours,
    totalExtraHours,
    trisemanaBreakdown,
    recordDistributions,
    totalMonthlyPatients: patientsBreakdown.day + patientsBreakdown.night + patientsBreakdown.holidayDay + patientsBreakdown.holidayNight,
    hoursBreakdown,
    hoursValues,
    avaBreakdown: avaVirtualBreakdown,
    avaValues: avaVirtualValues,
    patientsBreakdown,
    patientsValues,
    monthlyHours,
    legalDeductions,
    totalH,
    totalP,
    totalAVA,
    effectiveDeductionRate,
    avg6: avg6Proportional,
    avg6Prima,
    avg12,
    retefuenteBreakdown: {
      netIncome,
      dedDependents,
      dedPrepagada,
      dedInteresesVivienda,
      dedPensionVol,
      exempt25,
      totalDeductionsAndExemptions,
      cap40Percent,
      finalDeductionsAndExemptions,
      baseGravableFinal,
      baseUVT
    },
    taxBreakdown: {
      health,
      pension,
      fsp,
      legalDeductions,
      additionalDeductions: sumAdditionalDeductions,
      retefuente
    },
    grossBreakdown: {
      consultationBase: totalH,
      service: totalP,
      ava: totalAVA
    },
    additionalShiftsCount: records.filter(r => r.isAdditionalShift).length
  };
};

// --- Main Application Component ---

function MainApp() {
  console.log("MainApp: Starting hook calls...");
  // --- Auth & State ---
  const { user, isAuthReady, authError, isLoggingIn, login, logout, setAuthError } = useAuth();
  const [viewingArchive, setViewingArchive] = useState<SavedCalculation | null>(null);
  console.log("MainApp: Auth hook called successfully");

  // --- State ---
  const [rates, setRates] = useState<Rates>(DEFAULT_RATES);
  const ratesRef = useRef<Rates>(rates);
  useEffect(() => {
    ratesRef.current = rates;
  }, [rates]);

  const [shift, setShift] = useState<ShiftInput>({
    date: new Date().toISOString().split('T')[0],
    startTime: '07:00',
    endTime: '19:00',
    isHolidayStart: false,
    isHolidayEnd: false,
    isAVAShift: false,
    isVirtualShift: false,
    isExtraShift: false,
    isAdditionalShift: false,
    extraHoursType: 'consultation'
  });
  const [manualTrisemanaId, setManualTrisemanaId] = useState<string | null>(null);
  const [quantities, setQuantities] = useState<Quantities>({
    hours: { day: 0, night: 0, holidayDay: 0, holidayNight: 0, extraDay: 0, extraNight: 0, extraHolidayDay: 0, extraHolidayNight: 0 },
    ava: { day: 0, night: 0, holidayDay: 0, holidayNight: 0, extraDay: 0, extraNight: 0, extraHolidayDay: 0, extraHolidayNight: 0 },
    patients: { day: 0, night: 0, holidayDay: 0, holidayNight: 0 },
    applyPatients: true,
  });
  const [allRecords, setAllRecords] = useState<ShiftRecord[]>([]);
  const [trisemanas, setTrisemanas] = useState<Trisemana[]>([]);
  const [showTrisemanaModal, setShowTrisemanaModal] = useState(false);
  const [allDeductions, setAllDeductions] = useState<Deduction[]>([]);
  const [periods, setPeriods] = useState<BillingPeriod[]>([]);
  const [activePeriod, setActivePeriod] = useState<BillingPeriod | null>(null);
  const [selectedPeriodId, setSelectedPeriodId] = useState<string | null>(null);
  const [formTouched, setFormTouched] = useState(false);

  // 1. Version Checking & Cache Busting
  useEffect(() => {
    // Definimos una versión única para este despliegue
    const BUILD_ID = "v_20260501_0012";
    const storedVersion = localStorage.getItem('app_deployment_id');

    if (storedVersion && storedVersion !== BUILD_ID) {
      console.warn("Nueva versión detectada, actualizando aplicación...");
      localStorage.setItem('app_deployment_id', BUILD_ID);
      
      // Limpiar caches de service workers si existieran en el futuro
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.getRegistrations().then(registrations => {
          for (const registration of registrations) {
            registration.unregister();
          }
        });
      }

      // Recarga forzada para obtener los nuevos assets de Vite
      window.location.reload();
    } else {
      localStorage.setItem('app_deployment_id', BUILD_ID);
    }
  }, []);
  const [showPeriodModal, setShowPeriodModal] = useState(false);
  const [newTrisemanaData, setNewTrisemanaData] = useState({
    name: '',
    startDate: new Date().toISOString().split('T')[0],
    endDate: new Date(Date.now() + 21 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    maxHours: 132
  });
  const [showHelp, setShowHelp] = useState<{ title: string, content: string } | null>(null);
  const [showTrisemanaHistory, setShowTrisemanaHistory] = useState(false);
  const [showReteDetail, setShowReteDetail] = useState(false);
  const [showHistoricalModal, setShowHistoricalModal] = useState(false);
  const [historicalData, setHistoricalData] = useState({
    name: '',
    gross: 0,
    month: new Date().getMonth() + 1,
    year: new Date().getFullYear()
  });

  const [editingPeriod, setEditingPeriod] = useState<BillingPeriod | null>(null);
  const [editingTrisemana, setEditingTrisemana] = useState<Trisemana | null>(null);
  const [newPeriodData, setNewPeriodData] = useState({
    name: '',
    startDate: '',
    endDate: '',
    extraThreshold: 160
  });

  // --- Firestore Sync ---
  // --- Rates Sync ---
  const lastRatesUpdate = useRef<number>(0);

  useEffect(() => {
    if (!isAuthReady || !user) {
      setRates(DEFAULT_RATES);
      return;
    }

    const userPath = `users/${user.uid}`;
    const unsubscribeUser = onSnapshot(doc(db, userPath), (snapshot) => {
      if (snapshot.exists()) {
        const userData = snapshot.data();
        if (userData.rates) {
          // If we have a pending local write, or we just wrote recently, 
          // ignore the snapshot to avoid reverting local state during debounce/sync
          if (snapshot.metadata.hasPendingWrites || Date.now() - lastRatesUpdate.current < 2000) {
            return;
          }

          let updatedRates = { ...userData.rates };
          let changed = false;

          // Migration: Ensure 2026 default billing cutoff is 29 and night shift starts at 19 (7 PM)
          if (!updatedRates.payroll.billingCutoffDay || updatedRates.payroll.billingCutoffDay === 25) {
            updatedRates.payroll.billingCutoffDay = 29;
            changed = true;
          }
          
          if (!updatedRates.payroll.nightShiftStart) {
            updatedRates.payroll.nightShiftStart = 19;
            changed = true;
          }

          // Migration: Add missing fields if they don't exist
          const missingFields: Record<string, any> = {
            usePrepagada: true,
            usePensionVoluntaria: true,
            useInteresesVivienda: true,
            primaLastResetDate: null,
            useManualRetefuente: false,
            manualRetefuentePct: 0,
          };

          Object.entries(missingFields).forEach(([key, value]) => {
            if (updatedRates.payroll[key] === undefined) {
              updatedRates.payroll[key] = value;
              changed = true;
            }
          });

          if (changed || JSON.stringify(updatedRates) !== JSON.stringify(ratesRef.current)) {
            setRates(updatedRates);
          }
        }
      } else {
        // Create user document if it doesn't exist
        const newUser = {
          uid: user.uid,
          email: user.email,
          displayName: user.displayName,
          photoURL: user.photoURL,
          createdAt: new Date().toISOString(),
          rates: DEFAULT_RATES
        };
        setDoc(doc(db, userPath), newUser).catch(err => 
          handleFirestoreError(err, OperationType.CREATE, userPath)
        );
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, userPath);
    });

    return () => unsubscribeUser();
  }, [isAuthReady, user]);

  // Save rates whenever they change locally
  useEffect(() => {
    if (!isAuthReady || !user) return;

    // Immediately mark that we have a local change to ignore server snapshots for a bit
    lastRatesUpdate.current = Date.now();

    const userPath = `users/${user.uid}`;
    // We use a timeout to debounce updates to Firestore
    const timeout = setTimeout(() => {
      updateDoc(doc(db, userPath), { rates }).catch(err => 
        handleFirestoreError(err, OperationType.UPDATE, userPath)
      );
    }, 400); // Slightly faster debounce

    return () => clearTimeout(timeout);
  }, [rates, user, isAuthReady]);

  useEffect(() => {
    if (!isAuthReady || !user) {
      setAllRecords([]);
      setAllDeductions([]);
      setPeriods([]);
      setActivePeriod(null);
      setSelectedPeriodId(null);
      return;
    }

    // Sync Periods
    const periodsPath = `users/${user.uid}/periods`;
    const unsubscribePeriods = onSnapshot(collection(db, periodsPath), (snapshot) => {
      const periodsData = snapshot.docs.map(doc => doc.data() as BillingPeriod);
      const sortedPeriods = periodsData.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      setPeriods(sortedPeriods);
      
      const active = sortedPeriods.find(p => p.status === 'active');
      setActivePeriod(active || null);
      
      // If no period is selected, default to the active one or the latest archived one
      if (!selectedPeriodId) {
        if (active) {
          setSelectedPeriodId(active.id);
        } else if (sortedPeriods.length > 0) {
          setSelectedPeriodId(sortedPeriods[0].id);
        }
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, periodsPath);
    });

    // Sync Trisemanas
    const trisemanasPath = `users/${user.uid}/trisemanas`;
    const unsubscribeTrisemanas = onSnapshot(collection(db, trisemanasPath), (snapshot) => {
      const trisemanasData = snapshot.docs.map(doc => doc.data() as Trisemana);
      setTrisemanas(trisemanasData.sort((a, b) => b.startDate.localeCompare(a.startDate)));
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, trisemanasPath);
    });

    return () => {
      unsubscribePeriods();
      unsubscribeTrisemanas();
    };
  }, [isAuthReady, user]);

  useEffect(() => {
    if (!isAuthReady || !user) {
      setAllRecords([]);
      setAllDeductions([]);
      return;
    }

    const recordsPath = `users/${user.uid}/records`;
    const unsubscribeAllRecords = onSnapshot(collection(db, recordsPath), (snapshot) => {
      const recordsData = snapshot.docs.map(doc => doc.data() as ShiftRecord);
      setAllRecords(sortRecords(recordsData));
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, recordsPath);
    });

    const deductionsPath = `users/${user.uid}/deductions`;
    const unsubscribeDeductions = onSnapshot(collection(db, deductionsPath), (snapshot) => {
      const deductionsData = snapshot.docs.map(doc => doc.data() as Deduction);
      setAllDeductions(deductionsData);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, deductionsPath);
    });

    return () => {
      unsubscribeAllRecords();
      unsubscribeDeductions();
    };
  }, [isAuthReady, user]);

  // Combined real-time filtered values (Memoized for "simultaneous" feel)
  const records = useMemo(() => {
    if (!selectedPeriodId) return [];
    const currentPeriod = periods.find(p => p.id === selectedPeriodId);
    if (!currentPeriod) return [];

    const filtered = allRecords.filter(r => {
      if (r.periodId === selectedPeriodId) return true;
      if (!r.periodId && r.date >= currentPeriod.startDate && r.date <= currentPeriod.endDate) return true;
      return false;
    });
    return sortRecords(filtered);
  }, [allRecords, selectedPeriodId, periods]);

  const additionalDeductions = useMemo(() => {
    if (viewingArchive) return viewingArchive.additionalDeductions || [];
    if (!selectedPeriodId) return [];
    return allDeductions.filter(d => d.periodId === selectedPeriodId);
  }, [allDeductions, selectedPeriodId, viewingArchive]);

  // Auto-switch to archive view if selected period is archived
  useEffect(() => {
    if (!user || !selectedPeriodId) {
      setViewingArchive(null);
      return;
    }

    const period = periods.find(p => p.id === selectedPeriodId);
    if (period && period.status === 'archived' && (!viewingArchive || viewingArchive.id !== period.id)) {
      setViewingArchive({
        id: period.id,
        name: period.name,
        timestamp: period.createdAt,
        records: sortRecords(allRecords.filter(r => r.periodId === period.id || (!r.periodId && r.date >= period.startDate && r.date <= period.endDate))),
        rates: period.rates || rates,
        additionalDeductions: allDeductions.filter(d => d.periodId === period.id)
      });
    } else if (period && period.status === 'active' && viewingArchive) {
        // If we switched to an active period but were viewing an archive, reset
        setViewingArchive(null);
    }
  }, [selectedPeriodId, periods, user]);

  const [isSidebarOpen, setIsSidebarOpen] = useState(window.innerWidth >= 1024);
  
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth >= 1024) {
        setIsSidebarOpen(true);
      } else {
        setIsSidebarOpen(false);
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (records.some(r => !r.isDefinitive)) {
        e.preventDefault();
        e.returnValue = '';
        return '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [records]);

  const [showDetails, setShowDetails] = useState(false);
  const [savedCalculations, setSavedCalculations] = useState<SavedCalculation[]>(() => {
    try {
      const saved = localStorage.getItem('med_payroll_saved');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const [calcName, setCalcName] = useState('');
  const [autoCalculatePatients, setAutoCalculatePatients] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedRecordIds, setSelectedRecordIds] = useState<string[]>([]);
  const [toast, setToast] = useState<{ message: string, type: 'success' | 'error' | 'info' } | null>(null);
  
  // Logic for config locking and confirmation
  const handleEnableConfigEdit = () => {
    setTempRates(JSON.parse(JSON.stringify(rates)));
    setIsConfigLocked(false);
    showToast("Edición de configuración habilitada.", 'info');
  };

  const handleReviewConfigChanges = () => {
    if (!tempRates) {
      setIsConfigLocked(true);
      return;
    }

    const getRatesDiff = (r1: Rates, r2: Rates) => {
      const diffs: { label: string, old: any, new: any }[] = [];
      
      // Base
      if (r1.base.consultation !== r2.base.consultation) diffs.push({ label: 'Tarifa Consulta', old: r1.base.consultation, new: r2.base.consultation });
      if (r1.base.service !== r2.base.service) diffs.push({ label: 'Tarifa Servicio (Hora)', old: r1.base.service, new: r2.base.service });
      if (r1.base.ava !== r2.base.ava) diffs.push({ label: 'Tarifa AVA', old: r1.base.ava, new: r2.base.ava });
      
      // Patients
      if (r1.patient.day !== r2.patient.day) diffs.push({ label: 'Paciente Día', old: r1.patient.day, new: r2.patient.day });
      if (r1.patient.night !== r2.patient.night) diffs.push({ label: 'Paciente Noc', old: r1.patient.night, new: r2.patient.night });
      if (r1.patient.holidayDay !== r2.patient.holidayDay) diffs.push({ label: 'Paciente Fes Diu', old: r1.patient.holidayDay, new: r2.patient.holidayDay });
      if (r1.patient.holidayNight !== r2.patient.holidayNight) diffs.push({ label: 'Paciente Fes Noc', old: r1.patient.holidayNight, new: r2.patient.holidayNight });
  
      // Payroll
      if (r1.payroll.jobTitle !== r2.payroll.jobTitle) diffs.push({ label: 'Cargo', old: r1.payroll.jobTitle, new: r2.payroll.jobTitle });
      if (r1.payroll.uvtValue !== r2.payroll.uvtValue) diffs.push({ label: 'Valor UVT', old: r1.payroll.uvtValue, new: r2.payroll.uvtValue });
      if (r1.payroll.billingCutoffDay !== r2.payroll.billingCutoffDay) diffs.push({ label: 'Día de Corte', old: r1.payroll.billingCutoffDay, new: r2.payroll.billingCutoffDay });
      if (r1.payroll.nightShiftStart !== r2.payroll.nightShiftStart) diffs.push({ label: 'Inicio Nocturna', old: r1.payroll.nightShiftStart, new: r2.payroll.nightShiftStart });
      if (r1.payroll.dependents !== r2.payroll.dependents) diffs.push({ label: 'Dependientes', old: r1.payroll.dependents ? 'Sí' : 'No', new: r2.payroll.dependents ? 'Sí' : 'No' });
      if (r1.payroll.prepagada !== r2.payroll.prepagada) diffs.push({ label: 'Prepagada', old: r1.payroll.prepagada, new: r2.payroll.prepagada });
      if (r1.payroll.interesesVivienda !== r2.payroll.interesesVivienda) diffs.push({ label: 'Int. Vivienda', old: r1.payroll.interesesVivienda, new: r2.payroll.interesesVivienda });
      if (r1.payroll.pensionVoluntaria !== r2.payroll.pensionVoluntaria) diffs.push({ label: 'Pens. Voluntaria', old: r1.payroll.pensionVoluntaria, new: r2.payroll.pensionVoluntaria });
      if (r1.payroll.useManualRetefuente !== r2.payroll.useManualRetefuente) diffs.push({ label: 'Retefuente Manual', old: r1.payroll.useManualRetefuente ? 'Activado' : 'Desactivado', new: r2.payroll.useManualRetefuente ? 'Activado' : 'Desactivado' });
      if (r1.payroll.manualRetefuentePct !== r2.payroll.manualRetefuentePct) diffs.push({ label: 'Pct Retefuente Manual', old: r1.payroll.manualRetefuentePct + '%', new: r2.payroll.manualRetefuentePct + '%' });
  
      return diffs;
    };

    const diffs = getRatesDiff(tempRates, rates);
    
    if (diffs.length === 0) {
      setIsConfigLocked(true);
      setTempRates(null);
      showToast("No se detectaron cambios en la configuración.");
      return;
    }

    setConfigDiffs(diffs);
    setShowConfigConfirmModal(true);
  };

  const confirmConfigChanges = async () => {
    setIsConfigLocked(true);
    setTempRates(null);
    setShowConfigConfirmModal(false);
    
    // Explicitly sync to Firestore if user is authenticated
    if (user) {
      try {
        await updateDoc(doc(db, `users/${user.uid}`), { rates });
        showToast("Configuración guardada y sincronizada.", 'success');
      } catch (error) {
        handleFirestoreError(error, OperationType.UPDATE, `users/${user.uid}`);
      }
    } else {
      showToast("Cambios aplicados localmente.", 'success');
    }
  };

  const discardConfigChanges = () => {
    if (tempRates) {
      setRates(tempRates);
    }
    setIsConfigLocked(true);
    setTempRates(null);
    setShowConfigConfirmModal(false);
    showToast("Cambios descartados.");
  };

  const [showPeriodSelectionModal, setShowPeriodSelectionModal] = useState(false);
  const [showAccumulatedDetails, setShowAccumulatedDetails] = useState(false);
  const [showAccumulatedComponents, setShowAccumulatedComponents] = useState(false);
  const [showProjectionDetails, setShowProjectionDetails] = useState(false);
  const [extractVerified, setExtractVerified] = useState<{ isValid: boolean; errorRecords: string[] }>({ isValid: true, errorRecords: [] });
  const [isConfigLocked, setIsConfigLocked] = useState(true);
  const [tempRates, setTempRates] = useState<Rates | null>(null);
  const [showConfigConfirmModal, setShowConfigConfirmModal] = useState(false);
  const [configDiffs, setConfigDiffs] = useState<{ label: string, old: any, new: any }[]>([]);

  // --- Calculations ---
  const results = useMemo(() => {
    const baseRecords = viewingArchive ? viewingArchive.records : records;
    const currentPeriod = periods.find(p => p.id === selectedPeriodId);
    
    // Normalize calculation rates to ensure all fields exist
    // IMPORTANT: For active periods, always use global rates to allow live editing
    const rawRates = viewingArchive 
      ? viewingArchive.rates 
      : (currentPeriod && currentPeriod.status === 'archived' ? (currentPeriod.rates || rates) : rates);
    const calculationRates = normalizeRates(rawRates);

    let recordsToCalculate = [...baseRecords];
    let allRecordsToCalculate = viewingArchive && currentPeriod 
      ? allRecords.filter(r => r.date <= currentPeriod.endDate)
      : [...allRecords];

    // Real-time projection: if we are not editing (meaning we are adding), 
    // and the current form has a date, inject it as a projection if it's not already in recordsToCalculate
    // DISABLE projections for archived views or archived periods
    const isShiftDirty = !viewingArchive && currentPeriod?.status !== 'archived' && formTouched && (Object.values(quantities.hours).some(v => v > 0) || 
                        Object.values(quantities.ava).some(v => v > 0) || 
                        Object.values(quantities.patients).some(v => v > 0));

    if (!viewingArchive && currentPeriod?.status !== 'archived' && editingId) {
      const currentFormRecord: ShiftRecord = {
        id: editingId,
        userId: user?.uid || '',
        periodId: selectedPeriodId || undefined,
        date: shift.date,
        startTime: shift.startTime,
        endTime: shift.endTime,
        hours: { ...quantities.hours },
        ava: { ...quantities.ava },
        patients: { ...quantities.patients },
        applyPatients: quantities.applyPatients,
        isDefinitive: (viewingArchive 
          ? viewingArchive.records.find(r => r.id === editingId)?.isDefinitive 
          : records.find(r => r.id === editingId)?.isDefinitive) || false,
        isExtraShift: shift.isExtraShift,
        isHolidayStart: shift.isHolidayStart,
        isHolidayEnd: shift.isHolidayEnd,
        isAVAShift: shift.isAVAShift,
        isVirtualShift: shift.isVirtualShift,
        isAdditionalShift: shift.isAdditionalShift,
        extraHoursType: shift.extraHoursType
      };
      recordsToCalculate = recordsToCalculate.map(r => r.id === editingId ? currentFormRecord : r);
      allRecordsToCalculate = allRecordsToCalculate.map(r => r.id === editingId ? currentFormRecord : r);
    } else if (shift.date && isShiftDirty) {
      // Logic for real-time adding projection
      const draftRecord: ShiftRecord = {
        id: 'draft-temp-id',
        userId: user?.uid || '',
        periodId: selectedPeriodId || undefined,
        date: shift.date,
        startTime: shift.startTime,
        endTime: shift.endTime,
        hours: { ...quantities.hours },
        ava: { ...quantities.ava },
        patients: { ...quantities.patients },
        applyPatients: quantities.applyPatients,
        isDefinitive: false, // Draft is always a projection
        isExtraShift: shift.isExtraShift,
        isHolidayStart: shift.isHolidayStart,
        isHolidayEnd: shift.isHolidayEnd,
        isAVAShift: shift.isAVAShift,
        isVirtualShift: shift.isVirtualShift,
        isAdditionalShift: shift.isAdditionalShift,
        extraHoursType: shift.extraHoursType
      };
      recordsToCalculate = [...recordsToCalculate, draftRecord];
      allRecordsToCalculate = [...allRecordsToCalculate, draftRecord];
    }

    const allResults = calculatePeriodTotals(
      recordsToCalculate,
      calculationRates,
      additionalDeductions,
      periods,
      selectedPeriodId,
      allRecordsToCalculate,
      trisemanas
    );

    // Instead of re-calculating from scratch, we extract the definitive totals 
    // from the same distribution to ensure cumulative thresholds (trisemanas) match.
    // This fixes the discrepancy where definitive-only calculation would 'reset' the trisemana counter.
    
    // We can't just filter the final results easily because they are aggregated.
    // However, we want the "Final Extract" to reflect what is actually recorded as definitive.
    // So we'll calculate definitiveResults as before BUT using the FULL set of all records 
    // to preserve temporal trisemana logic, then only summing the records that ARE definitive.

    // Let's create a specialized version of calculatePeriodTotals or just filter inside it.
    // Actually, the simplest way is to pass a filter to calculatePeriodTotals.
    
    const definitiveResults = calculatePeriodTotals(
      recordsToCalculate.filter(r => r.isDefinitive),
      calculationRates,
      additionalDeductions,
      periods,
      selectedPeriodId,
      allRecordsToCalculate, // We keep ALL records here so thresholds calculate correctly
      trisemanas
    );

    return {
      all: allResults,
      definitive: definitiveResults,
      calculationRates
    };
  }, [records, viewingArchive, periods, selectedPeriodId, rates, additionalDeductions, editingId, shift, quantities, user, allRecords, trisemanas, formTouched]);

  const allRecordsAreDefinitive = useMemo(() => {
    return records.length > 0 && records.every(r => r.isDefinitive);
  }, [records]);

  // Verification Engine: Checks if the aggregated results match the sum of individual record calculations
  useEffect(() => {
    if (!records.length) return;

    let totalGrossVerified = 0;
    
    // Sum gross from all records in the current period view
    records.forEach(r => {
      const isAVAMain = r.isAVAShift || r.isVirtualShift || (Object.values(r.ava || {}).some(v => (v as number) > 0) && Object.values(r.hours || {}).every(v => v === 0));
      const val = calculateShiftValue({
        ...r,
        isAVAShift: isAVAMain
      }, results.calculationRates);
      
      const recordGross = val.base + val.service + val.extraSurcharge + val.avaVirtual;
      totalGrossVerified += recordGross;
    });

    const difference = Math.abs(results.all.gross - totalGrossVerified);
    // If difference > 5 pesos, mark as invalid (allow small rounding differences)
    if (difference > 5) {
      setExtractVerified({ 
        isValid: false, 
        errorRecords: ["Sincronización de cálculos en proceso... En periodos con trisección de horas puede haber ajustes de minutos."] 
      });
    } else {
      setExtractVerified({ isValid: true, errorRecords: [] });
    }
  }, [records, results.all.gross, results.calculationRates]);
  const [showDeductionDetails, setShowDeductionDetails] = useState(false);
  const [showIncomeDetails, setShowIncomeDetails] = useState(false);
  const [originalRecord, setOriginalRecord] = useState<ShiftRecord | null>(null);
  const registrationRef = useRef<HTMLDivElement>(null);
  const [confirmDialog, setConfirmDialog] = useState<{
    title?: string;
    message: string;
    confirmLabel?: string;
    type?: 'delete' | 'edit' | 'info';
    changes?: { field: string; old: string; new: string }[];
    onConfirm: () => void;
  } | null>(null);

  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  // Save to localStorage whenever savedCalculations changes
  useEffect(() => {
    localStorage.setItem('med_payroll_saved', JSON.stringify(savedCalculations));
  }, [savedCalculations]);

  // --- Correction 5: Period Synchronization ---
  useEffect(() => {
    if (!selectedPeriodId && activePeriod) {
      setSelectedPeriodId(activePeriod.id);
    } else if (selectedPeriodId && !periods.find(p => p.id === selectedPeriodId)) {
      // El periodo seleccionado ya no existe, caer al activo
      setSelectedPeriodId(activePeriod?.id || (periods[0]?.id ?? null));
    }
  }, [periods, activePeriod, selectedPeriodId]);

  // --- Logic: Calculate Hours Distribution ---
  // --- Shift Distribution Logic ---
  const autoCalculatedDistribution = useMemo(() => {
    if (editingId && viewingArchive) return null;

    // 1. Find if this shift falls into a trisemana
    const trisemana = manualTrisemanaId 
      ? trisemanas.find(t => t.id === manualTrisemanaId)
      : trisemanas.find(t => shift.date >= t.startDate && shift.date <= t.endDate);
    
    let threshold = 0;
    let cumulative = 0;

    if (trisemana) {
      threshold = trisemana.maxHours;
      // Calculate cumulative hours in this trisemana before this shift
      const previousInTri = allRecords
        .filter(r => r.id !== editingId) // Exclude current record being edited
        .filter(r => (r.trisemanaId === trisemana.id) || (!r.trisemanaId && r.date >= trisemana.startDate && r.date <= trisemana.endDate))
        .filter(r => r.date < shift.date || (r.date === shift.date && r.startTime < shift.startTime))
        .sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));
      
      let triCumulative = 0;
      previousInTri.forEach(r => {
        const rem = Math.max(0, trisemana.maxHours - triCumulative);
        const d = calculateShiftDistribution({
          startTime: r.startTime,
          endTime: r.endTime,
          isHolidayStart: r.isHolidayStart || false,
          isHolidayEnd: r.isHolidayEnd || false
        }, rates, rem);
        triCumulative += (d.ord.day + d.ord.night + d.ord.holidayDay + d.ord.holidayNight);
      });
      cumulative = triCumulative;
    } else {
      const currentPeriod = periods.find(p => p.id === selectedPeriodId);
      threshold = currentPeriod?.extraThreshold || 0;
      
      // Calculate cumulative hours in current period before this shift
      const previousInPeriod = records
        .filter(r => r.id !== editingId) // Exclude current record being edited
        .filter(r => r.date < shift.date || (r.date === shift.date && r.startTime < shift.startTime))
        .sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));
      
      let periodCumulative = 0;
      previousInPeriod.forEach(r => {
        const rem = threshold > 0 ? Math.max(0, threshold - periodCumulative) : 999999;
        const d = calculateShiftDistribution({
          startTime: r.startTime,
          endTime: r.endTime,
          isHolidayStart: r.isHolidayStart || false,
          isHolidayEnd: r.isHolidayEnd || false
        }, rates, rem);
        periodCumulative += (d.ord.day + d.ord.night + d.ord.holidayDay + d.ord.holidayNight);
      });
      cumulative = periodCumulative;
    }

    const remaining = threshold > 0 ? Math.max(0, threshold - cumulative) : (trisemana ? 0 : 999999);
    const dist = calculateShiftDistribution(shift, rates, remaining);

    const h = {
      day: dist.ord.day,
      night: dist.ord.night,
      holidayDay: dist.ord.holidayDay,
      holidayNight: dist.ord.holidayNight,
      extraDay: dist.extra.day,
      extraNight: dist.extra.night,
      extraHolidayDay: dist.extra.holidayDay,
      extraHolidayNight: dist.extra.holidayNight,
      trisemanaId: trisemana?.id || null
    };

    return { h, isSpecial: shift.isAVAShift || shift.isVirtualShift };
  }, [shift.startTime, shift.endTime, shift.date, shift.isHolidayStart, shift.isHolidayEnd, shift.isAVAShift, shift.isVirtualShift, shift.isExtraShift, rates, selectedPeriodId, periods, records, allRecords, trisemanas, editingId, viewingArchive, manualTrisemanaId]);

  useEffect(() => {
    if (!autoCalculatedDistribution) return;

    const { h, isSpecial } = autoCalculatedDistribution;

    setQuantities(prev => {
      const zeroHours = { 
        day: 0, night: 0, holidayDay: 0, holidayNight: 0,
        extraDay: 0, extraNight: 0, extraHolidayDay: 0, extraHolidayNight: 0
      };
      const zeroPatients = { day: 0, night: 0, holidayDay: 0, holidayNight: 0 };

      // Si el usuario cambia el intervalo, queremos que los pacientes también se reinicien 
      // si no coinciden con las nuevas horas disponibles en esas categorías.
      // Siguiendo la petición del usuario: "el valor previo se reinicia a 0 y se reemplaza con el nuevo valor"
      
      return {
        ...prev,
        hours: isSpecial ? zeroHours : h,
        ava: (shift.isAVAShift || shift.isVirtualShift) ? h : zeroHours,
        patients: (autoCalculatePatients && !isSpecial) ? {
          day: h.day, night: h.night, holidayDay: h.holidayDay, holidayNight: h.holidayNight
        } : (isSpecial ? zeroPatients : (autoCalculatePatients ? zeroPatients : prev.patients)),
        applyPatients: isSpecial ? false : prev.applyPatients
      };
    });
  }, [autoCalculatedDistribution, autoCalculatePatients, shift.isAVAShift, shift.isVirtualShift]);

  // --- Actions ---
  const savePeriod = async () => {
    if (!user) return;
    if (!newPeriodData.startDate || !newPeriodData.endDate) {
      showToast('Por favor, ingresa las fechas de inicio y fin.', 'error');
      return;
    }

    const trimmedName = newPeriodData.name.trim();
    if (trimmedName) {
      const duplicate = periods.find(p => 
        p.name.trim().toLowerCase() === trimmedName.toLowerCase() && 
        (!editingPeriod || p.id !== editingPeriod.id)
      );
      if (duplicate) {
        showToast('Ya existe un periodo con ese nombre. Por favor, elige otro.', 'error');
        return;
      }
    }

    if (newPeriodData.startDate > newPeriodData.endDate) {
      showToast('La fecha de inicio no puede ser posterior a la fecha de fin.', 'error');
      return;
    }

    // Validar solapamiento con periodos existentes (solo para periodos nuevos)
    if (!editingPeriod) {
      const overlap = periods.find(p =>
        p.id !== editingPeriod?.id &&
        newPeriodData.startDate <= p.endDate &&
        newPeriodData.endDate >= p.startDate
      );
      if (overlap) {
        showToast(`Las fechas se solapan con el periodo "${overlap.name}". Ajusta las fechas.`, 'error');
        return;
      }
    }

    try {
      if (editingPeriod) {
        const path = `users/${user.uid}/periods/${editingPeriod.id}`;
        await updateDoc(doc(db, path), {
          name: trimmedName || `Periodo ${newPeriodData.startDate} - ${newPeriodData.endDate}`,
          startDate: newPeriodData.startDate,
          endDate: newPeriodData.endDate,
          extraThreshold: newPeriodData.extraThreshold,
          updatedAt: new Date().toISOString()
        });
        showToast('Periodo actualizado con éxito.');
      } else {
        const periodId = crypto.randomUUID();
        const newPeriod: BillingPeriod = {
          id: periodId,
          userId: user.uid,
          name: trimmedName || `Periodo ${newPeriodData.startDate} - ${newPeriodData.endDate}`,
          startDate: newPeriodData.startDate,
          endDate: newPeriodData.endDate,
          status: 'active',
          createdAt: new Date().toISOString(),
          extraThreshold: newPeriodData.extraThreshold,
          rates: { ...rates }
        };

        const path = `users/${user.uid}/periods/${periodId}`;
        
        // If there's an active period, archive it first
        if (activePeriod) {
          // Se recalculan los totales directamente desde Firestore para garantizar
          // que corresponden al periodo activo, sin depender del estado de la UI.
          const activeRecordsPath = `users/${user.uid}/records`;
          const activeQ = query(collection(db, activeRecordsPath), where('periodId', '==', activePeriod.id));
          const activeSnap = await getDocs(activeQ);
          const activeRecords = activeSnap.docs.map(d => d.data() as ShiftRecord);

          const activeDedPath = `users/${user.uid}/deductions`;
          const activeDedQ = query(collection(db, activeDedPath), where('periodId', '==', activePeriod.id));
          const activeDedSnap = await getDocs(activeDedQ);
          const activeDeductions = activeDedSnap.docs.map(d => d.data() as Deduction);

          const archiveTotals = calculatePeriodTotals(
            activeRecords,
            activePeriod.rates || rates,
            activeDeductions,
            periods,
            activePeriod.id
          );

          await updateDoc(doc(db, `users/${user.uid}/periods/${activePeriod.id}`), {
            status: 'archived',
            totalGross: archiveTotals.gross,
            totalGrossWithBenefits: archiveTotals.totalPatrimonial,
            totalDeductions: archiveTotals.totalDeductions,
            net: archiveTotals.net,
            primaProporcional: archiveTotals.primaProporcional,
            vacacionesProporcional: archiveTotals.vacacionesProporcional,
            cesantiasProporcional: archiveTotals.cesantiasProporcional,
            interesesCesantias: archiveTotals.interesesCesantias,
            rates: { ...rates }
          });
        }
        
        await setDoc(doc(db, path), newPeriod);
        setSelectedPeriodId(periodId);
        showToast('Nuevo periodo iniciado con éxito.');
      }
      
      setShowPeriodModal(false);
      setEditingPeriod(null);
      setNewPeriodData({ name: '', startDate: '', endDate: '', extraThreshold: 160 });
    } catch (error) {
      handleFirestoreError(error, editingPeriod ? OperationType.UPDATE : OperationType.CREATE, `users/${user.uid}/periods`);
    }
  };

  const openNewPeriodModal = () => {
    setEditingPeriod(null);
    
    let suggestedStart = new Date().toISOString().split('T')[0];
    if (periods.length > 0) {
      const lastPeriod = periods[0]; // descending order
      const lastEnd = new Date(lastPeriod.endDate + 'T12:00:00');
      const nextDay = new Date(lastEnd);
      nextDay.setDate(lastEnd.getDate() + 1);
      suggestedStart = nextDay.toISOString().split('T')[0];
    }
    
    // Calculate suggested end date based on cutoff
    const startDateObj = new Date(suggestedStart + 'T12:00:00');
    let targetYear = startDateObj.getFullYear();
    let targetMonth = startDateObj.getMonth();
    let cutoff = rates.payroll.billingCutoffDay;
    if (targetMonth === 1) cutoff = Math.min(cutoff, 27);
    
    let suggestedEndObj = new Date(targetYear, targetMonth, cutoff);
    if (suggestedEndObj <= startDateObj) {
      targetMonth++;
      if (targetMonth > 11) {
        targetMonth = 0;
        targetYear++;
      }
      cutoff = rates.payroll.billingCutoffDay;
      if (targetMonth === 1) cutoff = Math.min(cutoff, 27);
      suggestedEndObj = new Date(targetYear, targetMonth, cutoff);
    }

    setNewPeriodData({
      name: '',
      startDate: suggestedStart,
      endDate: suggestedEndObj.toISOString().split('T')[0],
      extraThreshold: 132
    });
    setShowPeriodModal(true);
  };

  const openEditPeriod = (period: BillingPeriod) => {
    setEditingPeriod(period);
    setNewPeriodData({
      name: period.name,
      startDate: period.startDate,
      endDate: period.endDate,
      extraThreshold: period.extraThreshold || 160
    });
    setShowPeriodModal(true);
  };

  const openHistoricalModal = () => {
    const lastMonth = new Date();
    lastMonth.setMonth(lastMonth.getMonth() - 1);
    setHistoricalData({
      name: lastMonth.toLocaleString('es-ES', { month: 'long', year: 'numeric' }),
      gross: rates.payroll.avgBilling12Months || 0,
      month: lastMonth.getMonth() + 1,
      year: lastMonth.getFullYear()
    });
    setShowHistoricalModal(true);
  };

  const saveHistoricalPeriod = async () => {
    if (!user) return;
    
    const startDate = `${historicalData.year}-${String(historicalData.month).padStart(2, '0')}-01`;
    const endDate = new Date(historicalData.year, historicalData.month, 0).toISOString().split('T')[0];
    
    const manualGross = historicalData.gross;
    const manualPrima = manualGross / 12;
    const manualCesantias = manualGross / 12;
    const manualInterest = manualCesantias * 0.12;
    const manualVacations = manualGross / 24;

    const newPeriod: BillingPeriod = {
      id: crypto.randomUUID(),
      userId: user.uid,
      name: historicalData.name || `${historicalData.year}-${historicalData.month}`,
      startDate,
      endDate,
      status: 'archived',
      createdAt: new Date().toISOString(),
      totalGross: manualGross,
      totalGrossWithBenefits: manualGross + manualPrima + manualCesantias + manualInterest + manualVacations,
      totalDeductions: 0,
      net: manualGross + manualPrima + manualCesantias + manualInterest + manualVacations,
      primaProporcional: manualPrima,
      cesantiasProporcional: manualCesantias,
      interesesCesantias: manualInterest,
      vacacionesProporcional: manualVacations,
      rates: rates
    };

    const periodPath = `users/${user.uid}/periods/${newPeriod.id}`;
    await setDoc(doc(db, periodPath), newPeriod).catch(err => 
      handleFirestoreError(err, OperationType.CREATE, periodPath)
    );
    
    setShowHistoricalModal(false);
    showToast("Periodo histórico registrado.");
  };

  const archiveActivePeriod = async () => {
    if (!user || !activePeriod) return;
    
    try {
      const path = `users/${user.uid}/periods/${activePeriod.id}`;
      await updateDoc(doc(db, path), {
        status: 'archived',
        totalGross: results.all.gross,
        totalGrossWithBenefits: results.all.totalPatrimonial,
        totalDeductions: results.all.totalDeductions,
        net: results.all.net,
        primaProporcional: results.all.primaProporcional,
        vacacionesProporcional: results.all.vacacionesProporcional,
        cesantiasProporcional: results.all.cesantiasProporcional,
        interesesCesantias: results.all.interesesCesantias,
        rates: rates
      });
      showToast("Periodo guardado y archivado correctamente.", 'success');
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${user.uid}/periods/${activePeriod.id}`);
    }
  };

  const openEditTrisemana = (trisemana: Trisemana) => {
    setEditingTrisemana(trisemana);
    setNewTrisemanaData({
      name: trisemana.name,
      startDate: trisemana.startDate,
      endDate: trisemana.endDate,
      maxHours: trisemana.maxHours
    });
    setShowTrisemanaModal(true);
  };

  const createTrisemana = async () => {
    if (!user) return;
    
    try {
        if (editingTrisemana) {
          const path = `users/${user.uid}/trisemanas/${editingTrisemana.id}`;
          await updateDoc(doc(db, path), {
            name: newTrisemanaData.name,
            startDate: newTrisemanaData.startDate,
            endDate: newTrisemanaData.endDate,
            maxHours: newTrisemanaData.maxHours
          });
          showToast("Trisemana actualizada con éxito.");
        } else {
          // Archive previous trisemanas (including those without status)
          const activeTrisemanas = trisemanas.filter(t => t.status !== 'archived');
          for (const t of activeTrisemanas) {
            await updateDoc(doc(db, `users/${user.uid}/trisemanas/${t.id}`), {
              status: 'archived'
            });
          }

        const id = crypto.randomUUID();
        const trisemana: Trisemana = {
          id,
          userId: user.uid,
          name: newTrisemanaData.name || `Trisemana ${newTrisemanaData.startDate}`,
          startDate: newTrisemanaData.startDate,
          endDate: newTrisemanaData.endDate,
          maxHours: newTrisemanaData.maxHours,
          status: 'active',
          createdAt: new Date().toISOString()
        };

        const path = `users/${user.uid}/trisemanas/${id}`;
        await setDoc(doc(db, path), trisemana);
        showToast("Trisemana creada con éxito.");
      }

      setShowTrisemanaModal(false);
      setEditingTrisemana(null);
      setNewTrisemanaData({
        name: '',
        startDate: new Date().toISOString().split('T')[0],
        endDate: new Date(Date.now() + 21 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        maxHours: 132
      });
    } catch (error) {
      handleFirestoreError(error, editingTrisemana ? OperationType.UPDATE : OperationType.CREATE, `users/${user.uid}/trisemanas`);
    }
  };

  const performRecordSave = async (newRecord: ShiftRecord) => {
    if (!user) return;
    const recordId = newRecord.id;

    if (viewingArchive) {
      const isFirestorePeriod = periods.some(p => p.id === viewingArchive.id);
      if (isFirestorePeriod) {
        const path = `users/${user.uid}/records/${recordId}`;
        try {
          await setDoc(doc(db, path), newRecord);
        } catch (error) {
          handleFirestoreError(error, editingId ? OperationType.UPDATE : OperationType.CREATE, path);
          return;
        }
      }

      const updatedRecords = editingId
        ? viewingArchive.records.map(r => r.id === editingId ? newRecord : r)
        : [...viewingArchive.records, newRecord];

      setViewingArchive({
        ...viewingArchive,
        records: sortRecords(updatedRecords)
      });
      resetShiftForm();
      showToast(editingId ? "Registro actualizado con éxito." : "Registro agregado con éxito.");
      return;
    }

    const path = `users/${user.uid}/records/${recordId}`;
    try {
      await setDoc(doc(db, path), newRecord);
      resetShiftForm();
      showToast(editingId ? "Registro actualizado con éxito." : "Registro agregado con éxito.");
    } catch (error) {
      handleFirestoreError(error, editingId ? OperationType.UPDATE : OperationType.CREATE, path);
    }
  };

  const resetShiftForm = () => {
    setEditingId(null);
    setFormTouched(false);
    setOriginalRecord(null);
    setManualTrisemanaId(null);
    setShift({
      date: new Date().toISOString().split('T')[0],
      startTime: '07:00',
      endTime: '19:00',
      isHolidayStart: false,
      isHolidayEnd: false,
      isAVAShift: false,
      isVirtualShift: false,
      isExtraShift: false,
      isAdditionalShift: false,
      extraHoursType: 'consultation'
    });
    setQuantities({
      hours: { day: 0, night: 0, holidayDay: 0, holidayNight: 0, extraDay: 0, extraNight: 0, extraHolidayDay: 0, extraHolidayNight: 0 },
      ava: { day: 0, night: 0, holidayDay: 0, holidayNight: 0, extraDay: 0, extraNight: 0, extraHolidayDay: 0, extraHolidayNight: 0 },
      patients: { day: 0, night: 0, holidayDay: 0, holidayNight: 0 },
      applyPatients: true,
    });
  };

  const addRecord = async () => {
    if (!user) return;
    if (!selectedPeriodId) {
      showToast('Por favor, inicia un periodo de facturación primero.', 'error');
      openNewPeriodModal();
      return;
    }

    const recordId = editingId || crypto.randomUUID();
    const newRecord: ShiftRecord = {
      id: recordId,
      userId: user.uid,
      periodId: selectedPeriodId,
      date: shift.date,
      startTime: shift.startTime,
      endTime: shift.endTime,
      hours: { ...quantities.hours },
      ava: { ...quantities.ava },
      patients: { ...quantities.patients },
      applyPatients: quantities.applyPatients,
      isDefinitive: editingId 
        ? (viewingArchive 
            ? viewingArchive.records.find(r => r.id === editingId)?.isDefinitive 
            : records.find(r => r.id === editingId)?.isDefinitive) || false 
        : false,
      isExtraShift: shift.isExtraShift,
      isAdditionalShift: shift.isAdditionalShift,
      isHolidayStart: shift.isHolidayStart,
      isHolidayEnd: shift.isHolidayEnd,
      isAVAShift: shift.isAVAShift,
      isVirtualShift: shift.isVirtualShift,
      extraHoursType: shift.extraHoursType,
      trisemanaId: manualTrisemanaId || autoCalculatedDistribution?.h.trisemanaId || null,
    };

    if (editingId && originalRecord) {
      const changes: { field: string; old: string; new: string }[] = [];
      
      if (newRecord.date !== originalRecord.date) 
        changes.push({ field: 'Fecha', old: originalRecord.date, new: newRecord.date });
      if (newRecord.startTime !== originalRecord.startTime || newRecord.endTime !== originalRecord.endTime)
        changes.push({ field: 'Horario', old: `${originalRecord.startTime}-${originalRecord.endTime}`, new: `${newRecord.startTime}-${newRecord.endTime}` });
      if (newRecord.isHolidayStart !== originalRecord.isHolidayStart)
        changes.push({ field: 'Inicio en Festivo', old: originalRecord.isHolidayStart ? 'Sí' : 'No', new: newRecord.isHolidayStart ? 'Sí' : 'No' });
      if (newRecord.isHolidayEnd !== originalRecord.isHolidayEnd)
        changes.push({ field: 'Fin en Festivo', old: originalRecord.isHolidayEnd ? 'Sí' : 'No', new: newRecord.isHolidayEnd ? 'Sí' : 'No' });
      if (newRecord.isAVAShift !== originalRecord.isAVAShift)
        changes.push({ field: 'Es AVA?', old: originalRecord.isAVAShift ? 'Sí' : 'No', new: newRecord.isAVAShift ? 'Sí' : 'No' });
      if (newRecord.applyPatients !== originalRecord.applyPatients)
        changes.push({ field: 'Aplica Pacientes?', old: originalRecord.applyPatients ? 'Sí' : 'No', new: newRecord.applyPatients ? 'Sí' : 'No' });
      
      if (newRecord.applyPatients) {
        if (newRecord.patients.day !== originalRecord.patients.day)
          changes.push({ field: 'Pacientes Día', old: String(originalRecord.patients.day), new: String(newRecord.patients.day) });
        if (newRecord.patients.night !== originalRecord.patients.night)
          changes.push({ field: 'Pacientes Noche', old: String(originalRecord.patients.night), new: String(newRecord.patients.night) });
        if (newRecord.patients.holidayDay !== originalRecord.patients.holidayDay)
          changes.push({ field: 'Pacientes F-Día', old: String(originalRecord.patients.holidayDay), new: String(newRecord.patients.holidayDay) });
        if (newRecord.patients.holidayNight !== originalRecord.patients.holidayNight)
          changes.push({ field: 'Pacientes F-Noche', old: String(originalRecord.patients.holidayNight), new: String(newRecord.patients.holidayNight) });
      }

      if (changes.length === 0) {
        setEditingId(null);
        setOriginalRecord(null);
        showToast("No se detectaron cambios.");
        return;
      }

      setConfirmDialog({
        title: 'Confirmar Modificaciones',
        message: 'Revisa el resumen de cambios antes de actualizar el registro.',
        confirmLabel: 'Guardar Cambios',
        type: 'edit',
        changes,
        onConfirm: () => performRecordSave(newRecord)
      });
    } else {
      await performRecordSave(newRecord);
    }
  };

  const removeRecord = async (id: string) => {
    if (!user) return;
    const baseRecords = viewingArchive ? viewingArchive.records : records;
    const recordToDelete = baseRecords.find(r => r.id === id);
    if (!recordToDelete) return;

    setConfirmDialog({
      title: 'Confirmar Eliminación',
      message: `¿Estás seguro de que deseas eliminar el turno del ${recordToDelete.date} (${recordToDelete.startTime} - ${recordToDelete.endTime})?`,
      confirmLabel: 'Eliminar Registro',
      type: 'delete',
      onConfirm: async () => {
        if (editingId === id) {
          setEditingId(null);
          setOriginalRecord(null);
        }

        if (viewingArchive) {
          const isFirestorePeriod = periods.some(p => p.id === viewingArchive.id);
          if (isFirestorePeriod) {
            const path = `users/${user.uid}/records/${id}`;
            try {
              await deleteDoc(doc(db, path));
            } catch (error) {
              handleFirestoreError(error, OperationType.DELETE, path);
              return;
            }
          }
          setViewingArchive({
            ...viewingArchive,
            records: viewingArchive.records.filter(r => r.id !== id)
          });
          setSelectedRecordIds(prev => prev.filter(rid => rid !== id));
          return;
        }

        const path = `users/${user.uid}/records/${id}`;
        try {
          await deleteDoc(doc(db, path));
          setSelectedRecordIds(prev => prev.filter(rid => rid !== id));
          
          if (selectedPeriodId) {
            const recordsPath = `users/${user.uid}/records`;
            const q = query(collection(db, recordsPath), where('periodId', '==', selectedPeriodId));
            const snapshot = await getDocs(q);
            const remainingRecords = snapshot.docs.map(doc => doc.data() as ShiftRecord);
            
            const period = periods.find(p => p.id === selectedPeriodId);
            const calcRates = period?.rates || rates;
            
            const newTotals = calculatePeriodTotals(remainingRecords, calcRates, additionalDeductions, periods, selectedPeriodId);
            
            await updateDoc(doc(db, `users/${user.uid}/periods/${selectedPeriodId}`), { 
              totalGross: newTotals.gross,
              totalGrossWithBenefits: newTotals.totalPatrimonial,
              totalDeductions: newTotals.totalDeductions,
              net: newTotals.net,
              primaProporcional: newTotals.primaProporcional,
              vacacionesProporcional: newTotals.vacacionesProporcional
            });
          }
        } catch (error) {
          handleFirestoreError(error, OperationType.DELETE, path);
        }
      }
    });
  };

  const deleteSelectedRecords = async () => {
    if (selectedRecordIds.length === 0) return;
    
    setConfirmDialog({
      message: `¿Estás seguro de que deseas eliminar ${selectedRecordIds.length} registros seleccionados?`,
      onConfirm: async () => {
        if (!user) return;
        try {
          const batch = writeBatch(db);
          for (const id of selectedRecordIds) {
            const path = `users/${user.uid}/records/${id}`;
            batch.delete(doc(db, path));
          }
          await batch.commit();
          
          if (selectedPeriodId) {
            const recordsPath = `users/${user.uid}/records`;
            const q = query(collection(db, recordsPath), where('periodId', '==', selectedPeriodId));
            const snapshot = await getDocs(q);
            const remainingRecords = snapshot.docs.map(doc => doc.data() as ShiftRecord);
            
            const period = periods.find(p => p.id === selectedPeriodId);
            const calcRates = period?.rates || rates;
            
            const newTotals = calculatePeriodTotals(remainingRecords, calcRates, additionalDeductions, periods, selectedPeriodId);
            
            await updateDoc(doc(db, `users/${user.uid}/periods/${selectedPeriodId}`), { 
              totalGross: newTotals.gross,
              totalGrossWithBenefits: newTotals.totalPatrimonial,
              totalDeductions: newTotals.totalDeductions,
              net: newTotals.net,
              primaProporcional: newTotals.primaProporcional,
              vacacionesProporcional: newTotals.vacacionesProporcional
            });
          }

          setSelectedRecordIds([]);
          showToast(`${selectedRecordIds.length} registros eliminados con éxito.`);
        } catch (error) {
          console.error("Error deleting multiple records:", error);
          showToast("Ocurrió un error al eliminar algunos registros.", 'error');
        }
      }
    });
  };

  const toggleSelectRecord = (id: string) => {
    setSelectedRecordIds(prev => 
      prev.includes(id) ? prev.filter(rid => rid !== id) : [...prev, id]
    );
  };

  const toggleSelectAll = () => {
    const currentRecords = viewingArchive ? viewingArchive.records : records;
    if (selectedRecordIds.length === currentRecords.length) {
      setSelectedRecordIds([]);
    } else {
      setSelectedRecordIds(currentRecords.map(r => r.id));
    }
  };

  const updatePeriodTotalGross = async () => {
    if (!user || !selectedPeriodId) return;
    const period = periods.find(p => p.id === selectedPeriodId);
    if (!period) return;
    
    const path = `users/${user.uid}/periods/${selectedPeriodId}`;
    try {
      await updateDoc(doc(db, path), { totalGross: results.all.gross });
      showToast('Total bruto del periodo actualizado con éxito.');
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  };

  const updatePeriodThreshold = async (threshold: number) => {
    if (!user || !selectedPeriodId) return;
    try {
      await updateDoc(doc(db, `users/${user.uid}/periods/${selectedPeriodId}`), {
        extraThreshold: threshold
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${user.uid}/periods/${selectedPeriodId}`);
    }
  };

  const updatePeriodName = async (id: string, newName: string) => {
    if (!user || !newName.trim()) return;
    const path = `users/${user.uid}/periods/${id}`;
    try {
      await updateDoc(doc(db, path), { name: newName.trim() });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  };

  const reactivatePeriod = async (id: string) => {
    if (!user) return;
    try {
      // Archive current active period if any
      if (activePeriod && activePeriod.id !== id) {
        await updateDoc(doc(db, `users/${user.uid}/periods/${activePeriod.id}`), { status: 'archived' });
      }
      // Reactivate target period
      await updateDoc(doc(db, `users/${user.uid}/periods/${id}`), { status: 'active' });
      setSelectedPeriodId(id);
      showToast('Periodo reactivado con éxito.');
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${user.uid}/periods/${id}`);
    }
  };

  const toggleRecordStatus = async (id: string) => {
    if (!user) return;

    const baseRecords = viewingArchive ? viewingArchive.records : records;
    const record = baseRecords.find(r => r.id === id);
    if (!record) return;

    const newStatus = !record.isDefinitive;

    if (viewingArchive) {
      // Update local state for archive
      setViewingArchive({
        ...viewingArchive,
        records: viewingArchive.records.map(r => 
          r.id === id ? { ...r, isDefinitive: newStatus } : r
        )
      });
      
      // Also update Firestore if it's a real record
      const path = `users/${user.uid}/records/${id}`;
      try {
        await updateDoc(doc(db, path), { isDefinitive: newStatus });
      } catch (error) {
        // Silently fail if record doesn't exist in Firestore (e.g. old local-only records)
      }
      return;
    }

    const path = `users/${user.uid}/records/${id}`;
    try {
      await updateDoc(doc(db, path), { isDefinitive: newStatus });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  };
  
  const toggleAdditionalShift = async (id: string) => {
    if (!user) return;
    const baseRecords = viewingArchive ? viewingArchive.records : records;
    const record = baseRecords.find(r => r.id === id);
    if (!record) return;

    const newStatus = !record.isAdditionalShift;

    if (viewingArchive) {
      setViewingArchive({
        ...viewingArchive,
        records: viewingArchive.records.map(r => 
          r.id === id ? { ...r, isAdditionalShift: newStatus } : r
        )
      });
      const path = `users/${user.uid}/records/${id}`;
      try { await updateDoc(doc(db, path), { isAdditionalShift: newStatus }); } catch (e) {}
      return;
    }

    const path = `users/${user.uid}/records/${id}`;
    try {
      await updateDoc(doc(db, path), { isAdditionalShift: newStatus });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  };

  const toggleAllRecordsStatus = async () => {
    if (!user || records.length === 0) return;
    
    // Determine target status: if all are definitive, set to false. Otherwise, set all to true.
    const allDefinitive = records.every(r => r.isDefinitive);
    const targetStatus = !allDefinitive;

    setConfirmDialog({
      title: targetStatus ? 'Marcar Todo como Definitivo' : 'Desmarcar Todo',
      message: `¿Estás seguro de que deseas marcar los ${records.length} registros del periodo como ${targetStatus ? 'DEFINITIVOS' : 'PROYECTADOS'}?`,
      confirmLabel: 'Confirmar Acción',
      onConfirm: async () => {
        try {
          const batch = writeBatch(db);
          records.forEach(r => {
            const path = `users/${user.uid}/records/${r.id}`;
            batch.update(doc(db, path), { isDefinitive: targetStatus });
          });
          await batch.commit();
          showToast(`Registros actualizados a ${targetStatus ? 'Definitivos' : 'Proyectados'}.`);
        } catch (error) {
          console.error("Error bulk updating status:", error);
          showToast("Error al actualizar registros.", 'error');
        }
      }
    });
  };

  const confirmLogout = () => {
    setConfirmDialog({
      title: 'Cerrar Sesión',
      message: '¿Estás seguro de que deseas salir de la aplicación? Tus datos están guardados en la nube.',
      confirmLabel: 'Cerrar Sesión',
      type: 'delete',
      onConfirm: () => {
        logout();
      }
    });
  };

  const editRecord = (record: ShiftRecord) => {
    setConfirmDialog({
      title: 'Editar Registro',
      message: `¿Deseas modificar los datos del turno del ${record.date} (${record.startTime} - ${record.endTime})?`,
      confirmLabel: 'Iniciar Edición',
      type: 'edit',
      onConfirm: () => {
        setEditingId(record.id);
        setFormTouched(true);
        setOriginalRecord(record);
        setShift({ 
          date: record.date,
          startTime: record.startTime,
          endTime: record.endTime,
          isHolidayStart: record.isHolidayStart || false,
          isHolidayEnd: record.isHolidayEnd || false,
          isAVAShift: record.isAVAShift || false,
          isVirtualShift: record.isVirtualShift || false,
          isExtraShift: record.isExtraShift || false,
          isAdditionalShift: record.isAdditionalShift || false,
          extraHoursType: record.extraHoursType || 'consultation'
        });
        setManualTrisemanaId(record.trisemanaId || null);
        setQuantities({
          hours: { ...record.hours },
          ava: { ...record.ava },
          patients: { ...record.patients },
          applyPatients: record.applyPatients,
        });
        
        if (registrationRef.current) {
          registrationRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }
    });
  };

  const exportToExcel = () => {
    const period = periods.find(p => p.id === selectedPeriodId);
    const baseRecords = viewingArchive ? viewingArchive.records : records;
    const periodName = period?.name || 'Extracto de Pago';
    
    // 1. Resumen de Encabezado
    const headerData = [
      ['EXTRACTO TÉCNICO DE PAGO'],
      ['Liquidación oficial de honorarios y prestaciones'],
      [''],
      ['Periodo:', periodName],
      ['Fecha Generación:', new Date().toLocaleString()],
      ['Trisemanas Relacionadas:', trisemanas.filter(t => 
        (t.startDate <= (period?.endDate || '') && t.endDate >= (period?.startDate || ''))
      ).map(t => `${t.startDate} al ${t.endDate}`).join(', ') || 'N/A'],
      [''],
      ['RESUMEN DE RESULTADOS'],
      ['Concepto', 'Cantidad/Unidad', 'Valor Bruto', 'Deducciones', 'Neto'],
      ['Consulta y Horas Libres', `${(results.all.hoursBreakdown.day + results.all.hoursBreakdown.night + results.all.hoursBreakdown.holidayDay + results.all.hoursBreakdown.holidayNight).toFixed(1)}h`, formatCurrency(results.all.grossBreakdown.consultationBase), '', ''],
      ['AVA y Virtuales', `${(results.all.avaBreakdown.day + results.all.avaBreakdown.night + results.all.avaBreakdown.holidayDay + results.all.avaBreakdown.holidayNight).toFixed(1)}h`, formatCurrency(results.all.grossBreakdown.ava), '', ''],
      ['Productividad Pacientes', `${results.all.totalMonthlyPatients} Pac`, formatCurrency(results.all.grossBreakdown.service), '', ''],
      ['TOTALES', '', formatCurrency(results.all.gross), formatCurrency(results.all.totalDeductions), formatCurrency(results.all.netCash)],
    ];

    const ws_header = utils.aoa_to_sheet(headerData);

    // 2. Discriminación de Horas, Pacientes y VALORES
    const detailedData = [
      ['DISCRIMINACIÓN DETALLADA'],
      ['Categoría', 'Diurna', 'Nocturna', 'Festiva Diu', 'Festiva Noc', 'Total'],
      ['Horas Consulta', results.all.hoursBreakdown.day.toFixed(1), results.all.hoursBreakdown.night.toFixed(1), results.all.hoursBreakdown.holidayDay.toFixed(1), results.all.hoursBreakdown.holidayNight.toFixed(1), (results.all.hoursBreakdown.day + results.all.hoursBreakdown.night + results.all.hoursBreakdown.holidayDay + results.all.hoursBreakdown.holidayNight).toFixed(1)],
      ['Valores Consulta', formatCurrency(results.all.hoursValues.day), formatCurrency(results.all.hoursValues.night), formatCurrency(results.all.hoursValues.holidayDay), formatCurrency(results.all.hoursValues.holidayNight), formatCurrency(results.all.grossBreakdown.consultationBase)],
      ['Horas AVA/Virt', results.all.avaBreakdown.day.toFixed(1), results.all.avaBreakdown.night.toFixed(1), results.all.avaBreakdown.holidayDay.toFixed(1), results.all.avaBreakdown.holidayNight.toFixed(1), (results.all.avaBreakdown.day + results.all.avaBreakdown.night + results.all.avaBreakdown.holidayDay + results.all.avaBreakdown.holidayNight).toFixed(1)],
      ['Valores AVA/Virt', formatCurrency(results.all.avaValues.day), formatCurrency(results.all.avaValues.night), formatCurrency(results.all.avaValues.holidayDay), formatCurrency(results.all.avaValues.holidayNight), formatCurrency(results.all.grossBreakdown.ava)],
      ['Unidades Pacientes', results.all.patientsBreakdown.day, results.all.patientsBreakdown.night, results.all.patientsBreakdown.holidayDay, results.all.patientsBreakdown.holidayNight, results.all.totalMonthlyPatients],
      ['Valores Pacientes', formatCurrency(results.all.patientsValues.day), formatCurrency(results.all.patientsValues.night), formatCurrency(results.all.patientsValues.holidayDay), formatCurrency(results.all.patientsValues.holidayNight), formatCurrency(results.all.grossBreakdown.service)],
      [''],
      ['DEDUCCIONES LEGALES'],
      ['Concepto', 'Valor', 'Observación'],
      ['Salud (4%)', `-${formatCurrency(results.all.taxBreakdown.health)}`, 'Deducción de Ley'],
      ['Pensión (4%)', `-${formatCurrency(results.all.taxBreakdown.pension)}`, 'Deducción de Ley'],
      ['Fondo Solidaridad', `-${formatCurrency(results.all.taxBreakdown.fsp)}`, results.all.taxBreakdown.fsp > 0 ? 'Aplicado por IBC > 4 SMMLV' : 'No Aplica'],
      ['Retención en la Fuente', `-${formatCurrency(results.all.taxBreakdown.retefuente)}`, rates.payroll.useManualRetefuente ? `Manual (${rates.payroll.manualRetefuentePct}%)` : 'Automático Ley'],
      ['Otras Deducciones', `-${formatCurrency(results.all.additionalDeductions)}`, 'Ajustes Manuales'],
      ['TOTAL DEDUCCIONES', `-${formatCurrency(results.all.totalDeductions)}`, ''],
      [''],
      ['PRESTACIONES SOCIALES ACUMULADAS'],
      ['Concepto', 'Valor Mensual (Proporcional)', 'Observación'],
      ['Prima de Servicios', formatCurrency(results.all.primaProporcional), 'Provisionada mensual'],
      ['Cesantías', formatCurrency(results.all.cesantiasProporcional), 'Provisionada mensual'],
      ['Intereses Cesantías', formatCurrency(results.all.interesesCesantias), '1% mensual de cesantías'],
      ['Vacaciones Proporcionales', formatCurrency(results.all.vacacionesProporcional), '1.25 días aprox por mes'],
    ];

    const ws_details = utils.aoa_to_sheet(detailedData);

    // 3. Listado de Turnos
    const turnsHeaders = [['FECHA', 'HORARIO', 'TIPO', 'HRS', 'PACIENTES', 'VALOR BRUTO']];
    const turnsData = baseRecords.map(r => {
      const isAVAMain = r.isAVAShift || r.isVirtualShift || (Object.values(r.ava || {}).some(v => (v as number) > 0) && Object.values(r.hours || {}).every(v => v === 0));
      const dist = results.all.recordDistributions[r.id];
      const val = calculateShiftValue({ ...r, isAVAShift: isAVAMain }, results.calculationRates);
      const totalHours = (dist?.ord.day || 0) + (dist?.ord.night || 0) + (dist?.ord.holidayDay || 0) + (dist?.ord.holidayNight || 0) +
                         (dist?.extra.day || 0) + (dist?.extra.night || 0) + (dist?.extra.holidayDay || 0) + (dist?.extra.holidayNight || 0);
      return [
        r.date, 
        `${r.startTime}-${r.endTime}`, 
        isAVAMain ? 'AVA/Virt' : 'Consul.', 
        totalHours.toFixed(1), 
        r.applyPatients ? (r.patients.day + r.patients.night + r.patients.holidayDay + r.patients.holidayNight) : 0, 
        val.base + val.service + val.avaVirtual
      ];
    });

    const ws_turns = utils.aoa_to_sheet([...turnsHeaders, ...turnsData]);

    const wb = utils.book_new();
    utils.book_append_sheet(wb, ws_header, 'Resumen');
    utils.book_append_sheet(wb, ws_details, 'Detalle');
    utils.book_append_sheet(wb, ws_turns, 'Bitácora');

    writeFile(wb, `Extracto_${periodName.replace(/\s+/g, '_')}.xlsx`);
  };

  const exportToPDF = (useDraft: boolean = false) => {
    try {
      const doc = new jsPDF() as any;
      const period = periods.find(p => p.id === selectedPeriodId);
      const baseRecords = viewingArchive ? viewingArchive.records : records;
      const periodName = period?.name || (useDraft ? 'Borrador de Pago' : 'Extracto de Pago');
      const dateRange = period ? `${period.startDate} a ${period.endDate}` : '';
      const semester = new Date().getMonth() < 6 ? '1' : '2';
      
      const activeResults = useDraft ? results.all : results.definitive;

      // Header
      doc.setFontSize(22);
      doc.setTextColor(15, 23, 42); // slate-900
      doc.setFont('helvetica', 'bold');
      doc.text(useDraft ? 'BORRADOR TÉCNICO DE PAGO' : 'EXTRACTO TÉCNICO DE PAGO', 14, 22);
      
      doc.setFontSize(8);
      doc.setTextColor(100, 116, 139); // slate-500
      doc.setFont('helvetica', 'normal');
      doc.text(useDraft ? 'PROYECCIÓN DE HONORARIOS Y PRESTACIONES' : 'LIQUIDACIÓN OFICIAL DE HONORARIOS Y PRESTACIONES', 14, 27);
      
      doc.setFontSize(9);
      doc.setTextColor(30, 41, 59); // slate-800
      const headerInfo = [
        `Periodo: ${periodName}`,
        `Rango: ${dateRange}`,
        `Cargo: ${rates.payroll.jobTitle}`,
        `Generado: ${new Date().toLocaleString()}`,
        `Trisemanas Relacionadas: ${trisemanas.filter(t => 
           (t.startDate <= (period?.endDate || '') && t.endDate >= (period?.startDate || ''))
        ).map(t => t.name).join(', ') || 'N/A'}`
      ];
      headerInfo.forEach((text, i) => doc.text(text, 14, 35 + (i * 5)));

      // 1. Resumen de Devengado
      doc.setFontSize(12);
      doc.setFont('helvetica', 'bold');
      doc.text('1. DESGLOSE DE INGRESOS (DEVENGADO)', 14, 65);
      
      const incomeData = [
        ['Concepto', 'Detalle/Horas', 'Valor'],
        ['Consulta y Horas Libres', `${(activeResults.hoursBreakdown.day + activeResults.hoursBreakdown.night + activeResults.hoursBreakdown.holidayDay + activeResults.hoursBreakdown.holidayNight + activeResults.hoursBreakdown.extraDay + activeResults.hoursBreakdown.extraNight + activeResults.hoursBreakdown.extraHolidayDay + activeResults.hoursBreakdown.extraHolidayNight).toFixed(1)}h Totales`, formatCurrency(activeResults.grossBreakdown.consultationBase)],
        ['AVA / Virtual', `${(activeResults.avaBreakdown.day + activeResults.avaBreakdown.night + activeResults.avaBreakdown.holidayDay + activeResults.avaBreakdown.holidayNight + activeResults.avaBreakdown.extraDay + activeResults.avaBreakdown.extraNight + activeResults.avaBreakdown.extraHolidayDay + activeResults.avaBreakdown.extraHolidayNight).toFixed(1)}h Totales`, formatCurrency(activeResults.grossBreakdown.ava)],
        ['Productividad (Pacientes)', `${activeResults.totalMonthlyPatients} Pacientes/Unidades`, formatCurrency(activeResults.grossBreakdown.service)],
        ['SUBTOTAL BRUTO', '', formatCurrency(activeResults.gross)],
      ];

      autoTable(doc, {
        startY: 68,
        head: [incomeData[0]],
        body: incomeData.slice(1, 4),
        foot: [incomeData[4]],
        theme: 'grid',
        headStyles: { fillColor: [15, 23, 42], textColor: 255 },
        footStyles: { fillColor: [241, 245, 249], textColor: [15, 23, 42], fontStyle: 'bold' },
        columnStyles: { 2: { halign: 'right' } }
      });

      // 2. Discriminación de Horas
      const nextY = (doc as any).lastAutoTable.finalY + 10;
      doc.setFontSize(12);
      doc.text('2. DISCRIMINACIÓN DE TURNOS Y VALORES', 14, nextY);
      
      const hourData = [
        ['Tipo / Categoría', 'Diurnas', 'Nocturnas', 'Festivas Diu', 'Festivas Noc', 'Totales'],
        ['Horas Consulta', activeResults.hoursBreakdown.day.toFixed(1), activeResults.hoursBreakdown.night.toFixed(1), activeResults.hoursBreakdown.holidayDay.toFixed(1), activeResults.hoursBreakdown.holidayNight.toFixed(1), (activeResults.hoursBreakdown.day + activeResults.hoursBreakdown.night + activeResults.hoursBreakdown.holidayDay + activeResults.hoursBreakdown.holidayNight).toFixed(1)],
        ['Valor Consulta', formatCurrency(activeResults.hoursValues.day), formatCurrency(activeResults.hoursValues.night), formatCurrency(activeResults.hoursValues.holidayDay), formatCurrency(activeResults.hoursValues.holidayNight), formatCurrency(activeResults.grossBreakdown.consultationBase)],
        ['Horas AVA / Virt', activeResults.avaBreakdown.day.toFixed(1), activeResults.avaBreakdown.night.toFixed(1), activeResults.avaBreakdown.holidayDay.toFixed(1), activeResults.avaBreakdown.holidayNight.toFixed(1), (activeResults.avaBreakdown.day + activeResults.avaBreakdown.night + activeResults.avaBreakdown.holidayDay + activeResults.avaBreakdown.holidayNight).toFixed(1)],
        ['Valor AVA / Virt', formatCurrency(activeResults.avaValues.day), formatCurrency(activeResults.avaValues.night), formatCurrency(activeResults.avaValues.holidayDay), formatCurrency(activeResults.avaValues.holidayNight), formatCurrency(activeResults.grossBreakdown.ava)],
        ['Uni. Pacientes', activeResults.patientsBreakdown.day, activeResults.patientsBreakdown.night, activeResults.patientsBreakdown.holidayDay, activeResults.patientsBreakdown.holidayNight, activeResults.totalMonthlyPatients],
        ['Valor Pacientes', formatCurrency(activeResults.patientsValues.day), formatCurrency(activeResults.patientsValues.night), formatCurrency(activeResults.patientsValues.holidayDay), formatCurrency(activeResults.patientsValues.holidayNight), formatCurrency(activeResults.grossBreakdown.service)],
      ];

      autoTable(doc, {
        startY: nextY + 3,
        head: [hourData[0]],
        body: hourData.slice(1),
        theme: 'grid',
        headStyles: { fillColor: [51, 65, 85] },
        styles: { fontSize: 7, halign: 'center' },
        columnStyles: { 0: { halign: 'left', fontStyle: 'bold' } }
      });

      // Extra Hours Table
      const extraY = (doc as any).lastAutoTable.finalY + 10;
      doc.text('ANEXO: HORAS EXTRAS CALIFICADAS', 14, extraY);
      const extraData = [
        ['Categoría', 'Extra Diu', 'Extra Noc', 'Extra F-Diu', 'Extra F-Noc', 'Total'],
        ['Horas Consulta', activeResults.hoursBreakdown.extraDay.toFixed(1), activeResults.hoursBreakdown.extraNight.toFixed(1), activeResults.hoursBreakdown.extraHolidayDay.toFixed(1), activeResults.hoursBreakdown.extraHolidayNight.toFixed(1), (activeResults.hoursBreakdown.extraDay + activeResults.hoursBreakdown.extraNight + activeResults.hoursBreakdown.extraHolidayDay + activeResults.hoursBreakdown.extraHolidayNight).toFixed(1)],
        ['Valor Consulta', formatCurrency(activeResults.hoursValues.extraDay), formatCurrency(activeResults.hoursValues.extraNight), formatCurrency(activeResults.hoursValues.extraHolidayDay), formatCurrency(activeResults.hoursValues.extraHolidayNight), formatCurrency(activeResults.hoursValues.extraDay + activeResults.hoursValues.extraNight + activeResults.hoursValues.extraHolidayDay + activeResults.hoursValues.extraHolidayNight)],
        ['Horas AVA/Virt', activeResults.avaBreakdown.extraDay.toFixed(1), activeResults.avaBreakdown.extraNight.toFixed(1), activeResults.avaBreakdown.extraHolidayDay.toFixed(1), activeResults.avaBreakdown.extraHolidayNight.toFixed(1), (activeResults.avaBreakdown.extraDay + activeResults.avaBreakdown.extraNight + activeResults.avaBreakdown.extraHolidayDay + activeResults.avaBreakdown.extraHolidayNight).toFixed(1)],
        ['Valor AVA/Virt', formatCurrency(activeResults.avaValues.extraDay), formatCurrency(activeResults.avaValues.extraNight), formatCurrency(activeResults.avaValues.extraHolidayDay), formatCurrency(activeResults.avaValues.extraHolidayNight), formatCurrency(activeResults.avaValues.extraDay + activeResults.avaValues.extraNight + activeResults.avaValues.extraHolidayDay + activeResults.avaValues.extraHolidayNight)],
      ];
      autoTable(doc, {
        startY: extraY + 3,
        head: [extraData[0]],
        body: extraData.slice(1),
        theme: 'grid',
        headStyles: { fillColor: [30, 41, 59] },
        styles: { fontSize: 7, halign: 'center' },
        columnStyles: { 0: { halign: 'left', fontStyle: 'bold' } }
      });

      // 3. Deducciones
      const dedY = (doc as any).lastAutoTable.finalY + 10;
      doc.setFontSize(12);
      doc.text('3. DEDUCCIONES LEGALES', 14, dedY);
      
      const deductionData = [
        ['Concepto', 'Base / Porcentaje', 'Valor'],
        ['Aporte Salud', `4% de ${formatCurrency(activeResults.ibc)}`, `-${formatCurrency(activeResults.taxBreakdown.health)}`],
        ['Aporte Pensión', `4% de ${formatCurrency(activeResults.ibc)}`, `-${formatCurrency(activeResults.taxBreakdown.pension)}`],
        ['Fondo Solidaridad', activeResults.taxBreakdown.fsp > 0 ? 'Aplicado' : 'N/A', `-${formatCurrency(activeResults.taxBreakdown.fsp)}`],
        ['Retefuente', rates.payroll.useManualRetefuente ? `${rates.payroll.manualRetefuentePct}%` : 'Tabla Art. 383', `-${formatCurrency(activeResults.taxBreakdown.retefuente)}`],
        ['Otras Deducciones', 'Manuales', `-${formatCurrency(activeResults.taxBreakdown.additionalDeductions)}`],
        ['TOTAL DEDUCCIONES', '', `-${formatCurrency(activeResults.totalDeductions)}`],
      ];

      autoTable(doc, {
        startY: dedY + 3,
        head: [deductionData[0]],
        body: deductionData.slice(1, 6),
        foot: [deductionData[6]],
        theme: 'grid',
        headStyles: { fillColor: [153, 27, 27] },
        footStyles: { fillColor: [254, 242, 242], textColor: [153, 27, 27] },
        columnStyles: { 2: { halign: 'right' } }
      });

      // 4. Beneficios Sociales
      const benY = (doc as any).lastAutoTable.finalY + 10;
      doc.text(`4. PRESTACIONES SOCIALES (SEMESTRE ${semester})`, 14, benY);
      
      const benefitData = [
        ['Concepto', 'Descripción', 'Valor Acumulado'],
        [`Prima de Servicios S${semester}`, `Cálculo proporcional mensual`, formatCurrency(activeResults.primaProporcional)],
        ['Cesantías', 'Ahorro prestacional', formatCurrency(activeResults.cesantiasProporcional)],
        ['Intereses Cesantías', '12% anual (1% mensual)', formatCurrency(activeResults.interesesCesantias)],
        ['Vacaciones', 'Descanso remunerado', formatCurrency(activeResults.vacacionesProporcional)],
        ['TOTAL PATRIMONIAL ACUMULADO', '', formatCurrency(activeResults.primaProporcional + activeResults.cesantiasProporcional + activeResults.interesesCesantias + activeResults.vacacionesProporcional)],
      ];

      autoTable(doc, {
        startY: benY + 3,
        head: [benefitData[0]],
        body: benefitData.slice(1, 5),
        foot: [benefitData[5]],
        theme: 'grid',
        headStyles: { fillColor: [30, 58, 138] },
        footStyles: { fillColor: [238, 242, 255], textColor: [30, 58, 138] },
        columnStyles: { 2: { halign: 'right' } }
      });

      // Final Net
      const netTotalY = (doc as any).lastAutoTable.finalY + 15;
      doc.setFillColor(15, 23, 42);
      doc.rect(14, netTotalY, 182, 20, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(14);
      doc.text('TOTAL NETO A RECIBIR (CAJA):', 20, netTotalY + 13);
      doc.setFontSize(18);
      doc.text(formatCurrency(activeResults.netCash), 190, netTotalY + 13, { align: 'right' });

      // 5. Listado Detallado de Turnos
      doc.addPage();
      doc.setTextColor(15, 23, 42);
      doc.setFontSize(14);
      doc.setFont('helvetica', 'bold');
      doc.text('5. ANEXO: LISTADO DETALLADO DE TURNOS', 14, 20);
      
      const detailedRecords = baseRecords
        .filter(r => useDraft || r.isDefinitive)
        .map(r => {
          const isAVAMain = r.isAVAShift || r.isVirtualShift || (Object.values(r.ava || {}).some(v => (v as number) > 0) && Object.values(r.hours || {}).every(v => v === 0));
          const val = calculateShiftValue(r, results.calculationRates);
          
          const h = r.hours || { day:0, night:0, holidayDay:0, holidayNight:0, extraDay:0, extraNight:0, extraHolidayDay:0, extraHolidayNight:0 };
          const a = r.ava || { day:0, night:0, holidayDay:0, holidayNight:0, extraDay:0, extraNight:0, extraHolidayDay:0, extraHolidayNight:0 };
          const p = r.patients || { day:0, night:0, holidayDay:0, holidayNight:0 };
          
          const totalHours = (h.day + h.night + h.holidayDay + h.holidayNight + h.extraDay + h.extraNight + h.extraHolidayDay + h.extraHolidayNight) +
                             (a.day + a.night + a.holidayDay + a.holidayNight + a.extraDay + a.extraNight + a.extraHolidayDay + a.extraHolidayNight);
          
          const hParts = [];
          if (h.day > 0) hParts.push(`${h.day}D`);
          if (h.night > 0) hParts.push(`${h.night}N`);
          if (h.holidayDay > 0) hParts.push(`${h.holidayDay}FD`);
          if (h.holidayNight > 0) hParts.push(`${h.holidayNight}FN`);
          if (h.extraDay > 0) hParts.push(`${h.extraDay}ED`);
          if (h.extraNight > 0) hParts.push(`${h.extraNight}EN`);
          if (h.extraHolidayDay > 0) hParts.push(`${h.extraHolidayDay}EFD`);
          if (h.extraHolidayNight > 0) hParts.push(`${h.extraHolidayNight}EFN`);

          const aParts = [];
          if (a.day > 0) aParts.push(`${a.day}D`);
          if (a.night > 0) aParts.push(`${a.night}N`);
          if (a.holidayDay > 0) aParts.push(`${a.holidayDay}FD`);
          if (a.holidayNight > 0) aParts.push(`${a.holidayNight}FN`);
          if (a.extraDay > 0) aParts.push(`${a.extraDay}ED`);
          if (a.extraNight > 0) aParts.push(`${a.extraNight}EN`);
          if (a.extraHolidayDay > 0) aParts.push(`${a.extraHolidayDay}EFD`);
          if (a.extraHolidayNight > 0) aParts.push(`${a.extraHolidayNight}EFN`);

          const hPartsStr = hParts.length > 0 ? hParts.join(',') : '';
          const aPartsStr = aParts.length > 0 ? aParts.join(',') : '';
          
          let extendedType = '';
          if (hPartsStr) extendedType += `C:[${hPartsStr}]`;
          if (aPartsStr) extendedType += (extendedType ? ' ' : '') + `A:[${aPartsStr}]`;
          if (!extendedType) extendedType = r.isAVAShift ? 'AVA/V' : 'Cons.';

          let patientDisplay = '0';
          if (r.applyPatients) {
            const partList = [];
            if (p.day > 0) partList.push(`${p.day}D`);
            if (p.night > 0) partList.push(`${p.night}N`);
            if (p.holidayDay > 0) partList.push(`${p.holidayDay}FD`);
            if (p.holidayNight > 0) partList.push(`${p.holidayNight}FN`);
            patientDisplay = partList.length > 0 ? partList.join('|') : '0';
          } else {
            patientDisplay = (h.day + h.night + h.holidayDay + h.holidayNight + h.extraDay + h.extraNight + h.extraHolidayDay + h.extraHolidayNight).toFixed(1) + 'h Prod';
          }

          return [
            r.date,
            `${r.startTime}-${r.endTime}`,
            extendedType,
            totalHours.toFixed(1),
            patientDisplay,
            formatCurrency(val.base + val.service + val.avaVirtual),
            r.isDefinitive ? 'Def' : 'Proj'
          ];
        });

      autoTable(doc, {
        startY: 25,
        head: [['Fecha', 'Horario', 'Tipo', 'Hrs', 'Pac/Hrs', 'Bruto', 'St']],
        body: detailedRecords,
        theme: 'striped',
        styles: { fontSize: 7 },
        headStyles: { fillColor: [51, 65, 85] }
      });

      doc.save(`${useDraft ? 'Borrador' : 'Extracto'}_${periodName.replace(/\s+/g, '_')}.pdf`);
      showToast(useDraft ? "Borrador PDF generado con éxito" : "Extracto PDF generado con éxito", "success");
    } catch (error) {
      console.error("PDF Error:", error);
      showToast("Error al generar el PDF. Verifica la consola.", "error");
    }
  };

  const exportToCSV = () => {
    const baseRecords = viewingArchive ? viewingArchive.records : records;
    if (baseRecords.length === 0) {
      showToast('No hay registros para exportar.', 'info');
      return;
    }

    const headers = [
      'Fecha', 'Inicio', 'Fin', 'Estado', 'Tipo',
      'Cons. Diu', 'Cons. Noc', 'Cons. F-Diu', 'Cons. F-Noc', 'Cons. E-Diu', 'Cons. E-Noc', 'Cons. EF-Diu', 'Cons. EF-Noc',
      'AVA. Diu', 'AVA. Noc', 'AVA. F-Diu', 'AVA. FN-Noc', 'AVA. E-Diu', 'AVA. E-Noc', 'AVA. EF-Diu', 'AVA. EF-Noc',
      'Pac Diu', 'Pac Noc', 'Pac F-Diu', 'Pac F-Noc'
    ];

    const rows = baseRecords.map(r => {
      const isAVAMain = r.isAVAShift || r.isVirtualShift || (Object.values(r.ava || {}).some(v => (v as number) > 0) && Object.values(r.hours || {}).every(v => v === 0));
      const h = r.hours || { day:0, night:0, holidayDay:0, holidayNight:0, extraDay:0, extraNight:0, extraHolidayDay:0, extraHolidayNight:0 };
      const a = r.ava || { day:0, night:0, holidayDay:0, holidayNight:0, extraDay:0, extraNight:0, extraHolidayDay:0, extraHolidayNight:0 };
      const p = r.patients || { day:0, night:0, holidayDay:0, holidayNight:0 };

      return [
        r.date, r.startTime, r.endTime, r.isDefinitive ? 'Definitivo' : 'Proyección',
        (h.day + h.night + h.holidayDay + h.holidayNight + h.extraDay + h.extraNight + h.extraHolidayDay + h.extraHolidayNight > 0 && a.day + a.night + a.holidayDay + a.holidayNight + a.extraDay + a.extraNight + a.extraHolidayDay + a.extraHolidayNight > 0) ? 'Mixto' : (isAVAMain ? 'AVA/Virtual' : 'Consulta'),
        h.day, h.night, h.holidayDay, h.holidayNight, h.extraDay, h.extraNight, h.extraHolidayDay, h.extraHolidayNight,
        a.day, a.night, a.holidayDay, a.holidayNight, a.extraDay, a.extraNight, a.extraHolidayDay, a.extraHolidayNight,
        p.day, p.night, p.holidayDay, p.holidayNight
      ];
    });

    // Add summary
    rows.push([]);
    rows.push(['RESUMEN']);
    rows.push(['Total Bruto (Base)', results.definitive.gross]);
    rows.push(['Prima Proporcional', results.definitive.primaProporcional]);
    rows.push(['Vacaciones Proporcionales', results.definitive.vacacionesProporcional]);
    rows.push(['Total Patrimonial', results.definitive.totalPatrimonial]);
    rows.push(['Deducciones Legales', results.definitive.legalDeductions]);
    rows.push(['Deducciones Adicionales', results.definitive.additionalDeductions]);
    rows.push(['Neto a Pagar (Caja)', results.definitive.netCash]);

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `extracto_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // --- Persistence Actions ---
  const loadCalculation = (saved: SavedCalculation) => {
    setViewingArchive({ ...saved });
    setRates(saved.rates);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const saveUpdatedArchive = async () => {
    if (!user || !viewingArchive) return;
    
    // Check if it's a Firestore period
    const period = periods.find(p => p.id === viewingArchive.id);
    if (period) {
      const path = `users/${user.uid}/periods/${period.id}`;
      try {
        await updateDoc(doc(db, path), {
          totalGross: results.definitive.gross,
          totalGrossWithBenefits: results.definitive.totalPatrimonial,
          totalDeductions: results.definitive.totalDeductions,
          net: results.definitive.net,
          primaProporcional: results.definitive.primaProporcional,
          vacacionesProporcional: results.definitive.vacacionesProporcional,
          cesantiasProporcional: results.definitive.cesantiasProporcional,
          interesesCesantias: results.definitive.interesesCesantias,
          updatedAt: new Date().toISOString()
        });
        showToast("Cambios guardados en el periodo.");
      } catch (error) {
        handleFirestoreError(error, OperationType.UPDATE, path);
      }
    } else {
      // Legacy localStorage archive
      const updatedArchives = savedCalculations.map(s => 
        s.id === viewingArchive.id ? { ...viewingArchive, timestamp: new Date().toLocaleString() } : s
      );
      setSavedCalculations(updatedArchives);
      showToast("Cambios guardados en el extracto local.");
    }
  };

  const saveAndClosePeriod = async () => {
    if (!user || !viewingArchive) return;
    await saveUpdatedArchive();
    setShowPeriodSelectionModal(true);
  };

  const deletePeriod = async (periodId: string) => {
    if (!user) return;
    const period = periods.find(p => p.id === periodId);
    if (!period) return;
    
    setConfirmDialog({
      title: 'Eliminar Periodo',
      message: `¿Estás seguro de que deseas eliminar el periodo "${period.name}" y todos sus registros asociados? Esta acción no se puede deshacer.`,
      confirmLabel: 'Si, Eliminar Todo',
      type: 'delete',
      onConfirm: async () => {
        try {
          // 1. Delete all records associated with this period
          const recordsPath = `users/${user.uid}/records`;
          const q = query(collection(db, recordsPath), where('periodId', '==', periodId));
          const snapshot = await getDocs(q);
          
          for (const d of snapshot.docs) {
            await deleteDoc(doc(db, `${recordsPath}/${d.id}`));
          }

          // 2. Delete the period itself
          await deleteDoc(doc(db, `users/${user.uid}/periods/${periodId}`));
          
          if (selectedPeriodId === periodId) {
            const remaining = periods.filter(p => p.id !== periodId);
            const nextActive = remaining.find(p => p.status === 'active');
            setSelectedPeriodId(nextActive ? nextActive.id : (remaining[0]?.id || null));
          }
          
          showToast(`Periodo "${period.name}" eliminado.`);
        } catch (error) {
          handleFirestoreError(error, OperationType.DELETE, `users/${user.uid}/periods/${periodId}`);
        }
      }
    });
  };

  const deleteTrisemana = async (id: string) => {
    if (!user) return;
    const trisemana = trisemanas.find(t => t.id === id);
    if (!trisemana) return;

    setConfirmDialog({
      title: 'Eliminar Trisemana',
      message: `¿Estás seguro de eliminar la ${trisemana.name}? El historial de horas se verá afectado para este rango.`,
      confirmLabel: 'Eliminar Trisemana',
      type: 'delete',
      onConfirm: async () => {
        const path = `users/${user.uid}/trisemanas/${id}`;
        try {
          await deleteDoc(doc(db, path));
          showToast("Trisemana eliminada.");
        } catch (error) {
          handleFirestoreError(error, OperationType.DELETE, path);
        }
      }
    });
  };

  const closeArchive = () => {
    setViewingArchive(null);
    // Restore current rates and deductions from live state if needed
    // Actually, rates and deductions are shared for now, but we could restore them if we wanted.
    // For now, just returning to live records is enough.
    showToast('Regresando a la bitácora en vivo.', 'info');
  };

  const deleteSavedCalculation = (id: string) => {
    const saved = savedCalculations.find(s => s.id === id);
    if (!saved) return;

    setConfirmDialog({
      title: 'Eliminar Historial',
      message: `¿Deseas eliminar el extracto guardado "${saved.name}" de tu historial local?`,
      confirmLabel: 'Eliminar Historial',
      type: 'delete',
      onConfirm: () => {
        setSavedCalculations(savedCalculations.filter(s => s.id !== id));
        showToast('Extracto eliminado.');
      }
    });
  };

  const addDeduction = async () => {
    if (!user || !selectedPeriodId) return;
    const deductionId = crypto.randomUUID();
    // Se guarda con concept inicial válido ('Nueva deducción') para cumplir con las reglas de Firestore.
    // Se incluye userId explícitamente.
    const deduction: Deduction = {
      id: deductionId,
      userId: user.uid,
      concept: 'Nueva deducción',
      amount: 0,
      applied: true,
      periodId: selectedPeriodId
    };
    const path = `users/${user.uid}/deductions/${deductionId}`;
    try {
      await setDoc(doc(db, path), deduction);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, path);
      showToast('Error al crear la deducción.', 'error');
    }
  };

  const updateDeduction = async (id: string, field: 'concept' | 'amount' | 'applied', value: string | number | boolean) => {
    if (!user) return;
    const path = `users/${user.uid}/deductions/${id}`;
    try {
      await updateDoc(doc(db, path), { [field]: value });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  };

  const removeDeduction = async (id: string) => {
    if (!user) return;
    const deduction = additionalDeductions.find(d => d.id === id);
    if (!deduction) return;

    setConfirmDialog({
      title: 'Eliminar Deducción',
      message: `¿Estás seguro de que deseas eliminar la deducción "${deduction.concept}"?`,
      confirmLabel: 'Eliminar Concepto',
      type: 'delete',
      onConfirm: async () => {
        const path = `users/${user.uid}/deductions/${id}`;
        try {
          await deleteDoc(doc(db, path));
          showToast(`Deducción "${deduction.concept}" eliminada.`);
        } catch (error) {
          handleFirestoreError(error, OperationType.DELETE, path);
        }
      }
    });
  };

  if (!isAuthReady) {
    return (
      <div className="min-h-screen-ios bg-slate-50 flex items-center justify-center">
        <div className="w-12 h-12 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen-ios bg-slate-50 flex items-center justify-center p-4 safe-top safe-bottom">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white p-8 rounded-3xl shadow-xl max-w-md w-full text-center space-y-8"
        >
          <div className="w-20 h-20 bg-indigo-100 text-indigo-600 rounded-2xl flex items-center justify-center mx-auto rotate-3">
            <Calculator className="w-10 h-10" />
          </div>
          <div className="space-y-2">
            <h1 className="text-2xl font-black text-slate-900 tracking-tight">EMI pagos</h1>
            <p className="text-slate-500 text-sm">Gestiona tus turnos y extractos de forma segura en la nube.</p>
          </div>
          <div className="space-y-4">
            <div className="p-4 bg-amber-50 border border-amber-100 rounded-2xl text-amber-800 text-sm">
              <p className="font-semibold mb-1 flex items-center gap-2">
                <AlertCircle className="w-4 h-4" />
                Bloqueo de terceros detectado
              </p>
              <p className="opacity-90">
                Tu navegador está bloqueando las cookies de terceros, lo que impide el inicio de sesión dentro de esta ventana.
              </p>
              <a 
                href={window.location.href} 
                target="_blank" 
                rel="noopener noreferrer"
                className="mt-3 inline-flex items-center gap-2 font-bold text-amber-900 hover:underline"
              >
                Abrir en una pestaña nueva <ExternalLink className="w-4 h-4" />
              </a>
            </div>

            {authError && (
              <div className="p-3 bg-rose-50 text-rose-600 text-xs rounded-xl flex items-center gap-2 border border-rose-100">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <p className="text-left">{authError}</p>
              </div>
            )}
            <button 
              onClick={login}
              disabled={isLoggingIn}
              className={`w-full py-4 flex items-center justify-center gap-3 bg-white border-2 border-slate-100 rounded-2xl font-bold text-slate-700 transition-all shadow-sm active:scale-95 ${isLoggingIn ? 'opacity-50 cursor-not-allowed' : 'hover:bg-slate-50 hover:border-indigo-100'}`}
            >
              {isLoggingIn ? (
                <div className="w-5 h-5 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
              ) : (
                <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google" className="w-5 h-5" />
              )}
              {isLoggingIn ? "Iniciando sesión..." : "Continuar con Google"}
            </button>
            <p className="text-[10px] text-slate-400">
              Al continuar, tus datos se guardarán automáticamente en tu cuenta personal.
            </p>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen-ios bg-[#F8FAFC] text-slate-900 font-sans selection:bg-indigo-100 flex flex-col overflow-x-hidden">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-40 px-4 md:px-6 py-4 flex items-center justify-between safe-top">
        <div className="flex items-center gap-3">
          <div className="bg-indigo-600 p-2 rounded-xl shadow-lg shadow-indigo-200">
            <Stethoscope className="text-white w-5 h-5 md:w-6 md:h-6" />
          </div>
          <div>
            <h1 className="text-lg md:text-xl font-bold tracking-tight text-slate-800">EMI pagos</h1>
            <p className="hidden md:block text-[10px] text-slate-500 font-medium uppercase tracking-wider">Colombia 2026 • Jornada Legal</p>
          </div>
        </div>
        
        <div className="flex items-center gap-2 md:gap-4">
          <div className="hidden sm:flex items-center gap-3 px-3 py-1.5 bg-slate-50 rounded-xl border border-slate-100">
            <img src={user.photoURL || ''} alt={user.displayName || ''} className="w-6 h-6 rounded-full" />
            <span className="text-xs font-bold text-slate-600 truncate max-w-[100px]">{user.displayName}</span>
          </div>
          <button 
            onClick={confirmLogout}
            className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-all"
            title="Cerrar sesión"
          >
            <LogOut className="w-5 h-5" />
          </button>
          <button 
            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            className="lg:hidden p-2 bg-indigo-50 text-indigo-600 rounded-xl hover:bg-indigo-100 transition-colors"
          >
            <Settings className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* Mobile Sidebar Overlay */}
      {isSidebarOpen && (
        <div 
          className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-40 lg:hidden"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      {/* Archive Viewing Banner */}
      {viewingArchive && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 md:px-6 py-3 flex flex-col md:flex-row items-center justify-between sticky top-[var(--header-height)] z-30 gap-3">
          <div className="flex items-center gap-3 w-full md:w-auto">
            <div className="bg-amber-100 p-1.5 rounded-lg">
              <FolderOpen className="text-amber-600 w-4 h-4" />
            </div>
            <div>
              <p className="text-[10px] font-bold text-amber-600 uppercase tracking-wider">Viendo Extracto Guardado</p>
              <h2 className="text-sm font-bold text-amber-900">{viewingArchive.name}</h2>
            </div>
          </div>
          <div className="flex items-center gap-2 w-full md:w-auto overflow-x-auto pb-1 md:pb-0 no-scrollbar">
            <button 
              onClick={saveUpdatedArchive}
              className="whitespace-nowrap px-4 py-2 bg-amber-600 text-white text-[10px] md:text-xs font-bold rounded-lg hover:bg-amber-700 transition-all flex items-center gap-2 shadow-sm shrink-0"
            >
              <Save className="w-3 h-3" />
              Guardar Cambios
            </button>
            <button 
              onClick={saveAndClosePeriod}
              className="whitespace-nowrap px-4 py-2 bg-indigo-600 text-white text-[10px] md:text-xs font-bold rounded-lg hover:bg-indigo-700 transition-all flex items-center gap-2 shadow-sm shrink-0"
            >
              <CheckCircle2 className="w-3 h-3" />
              Guardar y Cerrar
            </button>
            <button 
              onClick={closeArchive}
              className="whitespace-nowrap px-4 py-2 bg-white border border-amber-200 text-amber-700 text-[10px] md:text-xs font-bold rounded-lg hover:bg-amber-100 transition-all flex items-center gap-2 shrink-0"
            >
              <X className="w-3 h-3" />
              Cerrar
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-1 relative">
        {/* Sidebar: Configuration */}
        <aside className={`
          fixed inset-y-0 right-0 z-50 w-[85%] sm:w-80 bg-white border-l border-slate-200 transform transition-transform duration-300 ease-in-out lg:relative lg:translate-x-0 lg:z-0 lg:border-l-0 lg:border-r
          ${isSidebarOpen ? 'translate-x-0' : 'translate-x-full lg:hidden'}
          lg:sticky lg:top-[73px] lg:h-[calc(100vh-73px)] overflow-y-auto safe-bottom
        `}>
          <div className="p-4 md:p-6 space-y-8">
            <div className="lg:hidden flex items-center justify-between mb-4 border-b pb-4">
              <h2 className="font-bold text-slate-800 flex items-center gap-2">
                <Settings className="w-4 h-4" />
                Configuración
              </h2>
              <button 
                onClick={() => setIsSidebarOpen(false)}
                className="p-2 hover:bg-slate-100 rounded-lg"
              >
                <X className="w-5 h-5 text-slate-400" />
              </button>
            </div>
            {/* Period Selector */}
            <section className="bg-indigo-50 p-4 rounded-2xl border border-indigo-100">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2 text-indigo-700">
                  <Calendar className="w-4 h-4" />
                  <h2 className="text-xs font-bold uppercase tracking-widest">Periodos</h2>
                </div>
                <button 
                  onClick={openNewPeriodModal}
                  className="p-1.5 bg-white text-indigo-600 rounded-lg hover:bg-indigo-100 transition-colors shadow-sm"
                  title="Nuevo Periodo"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>
              
              <div className="space-y-3">
                <div className="space-y-1">
                  <label className="text-[9px] font-bold text-indigo-400 uppercase ml-1">Periodo Activo</label>
                  {activePeriod ? (
                    <div 
                      className={`p-3 rounded-xl border transition-all ${selectedPeriodId === activePeriod.id ? 'bg-white border-indigo-300 shadow-sm' : 'bg-indigo-100/50 border-transparent hover:bg-white'}`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span 
                          onClick={() => setSelectedPeriodId(activePeriod.id)}
                          className="text-xs font-bold text-slate-700 cursor-pointer flex-1"
                        >
                          {activePeriod.name}
                        </span>
                        <div className="flex items-center gap-2">
                          <button 
                            onClick={() => deletePeriod(activePeriod.id)}
                            className="p-1 text-slate-400 hover:text-rose-500 transition-colors"
                            title="Eliminar Periodo"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                          <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                        </div>
                      </div>
                      <div className="text-[9px] text-slate-500 font-medium">{activePeriod.startDate} al {activePeriod.endDate}</div>
                    </div>
                  ) : (
                   <button 
                     onClick={openNewPeriodModal}
                     className="w-full py-3 bg-white border border-dashed border-indigo-200 text-indigo-600 text-xs font-bold rounded-xl hover:bg-indigo-100 transition-all flex items-center justify-center gap-2"
                   >
                     <Plus className="w-3.5 h-3.5" />
                     Iniciar Periodo
                   </button>
                  )}
                </div>

                {periods.filter(p => p.status === 'archived').length > 0 && (
                  <div className="space-y-1">
                    <label className="text-[9px] font-bold text-slate-400 uppercase ml-1">Historial</label>
                    <div className="flex gap-2">
                      <select 
                        value={selectedPeriodId && periods.find(p => p.id === selectedPeriodId)?.status === 'archived' ? selectedPeriodId : ''}
                        onChange={(e) => setSelectedPeriodId(e.target.value)}
                        className="flex-1 bg-white border border-indigo-200 rounded-xl py-2 px-3 text-xs font-bold text-slate-700 focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                      >
                        <option value="" disabled>Ver historial...</option>
                        {periods.filter(p => p.status === 'archived').map(p => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                      {selectedPeriodId && periods.find(p => p.id === selectedPeriodId)?.status === 'archived' && (
                        <button 
                          onClick={() => deletePeriod(selectedPeriodId)}
                          className="p-2 bg-white border border-rose-200 text-rose-500 rounded-xl hover:bg-rose-50 transition-all"
                          title="Eliminar Periodo Seleccionado"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </section>

            {/* Trisemanas Section */}
            <section className="bg-amber-50 p-4 rounded-2xl border border-amber-100">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2 text-amber-700">
                  <Clock className="w-4 h-4" />
                  <h2 className="text-xs font-bold uppercase tracking-widest">Trisemanas</h2>
                </div>
                <button 
                  onClick={() => {
                    setEditingTrisemana(null);
                    setShowTrisemanaModal(true);
                  }}
                  className="p-1.5 bg-white text-amber-600 rounded-lg hover:bg-amber-100 transition-colors shadow-sm border border-amber-200"
                  title="Nueva Trisemana"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>
              
              <div className="space-y-3">
                {/* Trisemanas del Periodo Seleccionado */}
                {(() => {
                  const p = periods.find(per => per.id === selectedPeriodId);
                  if (!p) return null;
                  const periodTris = trisemanas.filter(t => 
                    (t.startDate >= p.startDate && t.startDate <= p.endDate) || 
                    (t.endDate >= p.startDate && t.endDate <= p.endDate) ||
                    (t.startDate <= p.startDate && t.endDate >= p.endDate)
                  );
                  
                  if (periodTris.length === 0) {
                    return (
                      <button 
                        onClick={() => {
                          setEditingTrisemana(null);
                          setShowTrisemanaModal(true);
                        }}
                        className="w-full py-3 bg-white border border-dashed border-amber-200 text-amber-600 text-xs font-bold rounded-xl hover:bg-amber-100 transition-all flex items-center justify-center gap-2"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        Vincular Trisemana
                      </button>
                    );
                  }

                  return periodTris.map(t => (
                    <div 
                      key={t.id}
                      className={`p-3 border rounded-xl shadow-sm transition-all ${
                        t.status === 'active' 
                          ? 'bg-amber-50 border-amber-200 ring-1 ring-amber-100' 
                          : 'bg-white border-slate-100'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className={`text-xs font-bold truncate ${t.status === 'active' ? 'text-amber-900' : 'text-slate-700'}`}>
                            {t.name}
                          </span>
                          {t.status === 'active' && (
                            <div className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse shrink-0" />
                          )}
                        </div>
                        <div className="flex items-center gap-1">
                          <button 
                            onClick={() => openEditTrisemana(t)}
                            className="p-1 text-slate-400 hover:text-amber-600 transition-colors"
                            title="Editar"
                          >
                            <Edit3 className="w-3 h-3" />
                          </button>
                          <button 
                            onClick={() => deleteTrisemana(t.id)}
                            className="p-1 text-slate-400 hover:text-rose-500 transition-colors"
                            title="Eliminar"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                      <div className="flex flex-col gap-0.5">
                        <div className="flex items-center justify-between">
                          <span className="text-[9px] text-slate-500">{t.startDate} al {t.endDate}</span>
                          <span className="text-[9px] font-bold text-amber-600">{t.maxHours}h</span>
                        </div>
                        <div className="text-[8px] font-bold text-amber-500/60 truncate uppercase tracking-tighter">
                          Periodo: {p.name}
                        </div>
                      </div>
                    </div>
                  ));
                })()}

                {/* Histórico General */}
                {(() => {
                  const p = periods.find(per => per.id === selectedPeriodId);
                  const historyTris = trisemanas.filter(t => {
                    if (!p) return t.status !== 'active';
                    const isRelevant = (t.startDate >= p.startDate && t.startDate <= p.endDate) || 
                                     (t.endDate >= p.startDate && t.endDate <= p.endDate) ||
                                     (t.startDate <= p.startDate && t.endDate >= p.endDate);
                    return !isRelevant;
                  });

                  if (historyTris.length === 0) return null;

                  return (
                    <div className="space-y-1">
                      <button 
                        onClick={() => setShowTrisemanaHistory(!showTrisemanaHistory)}
                        className="w-full flex items-center justify-between px-2 py-1 hover:bg-amber-100/50 rounded-lg transition-all group"
                      >
                        <div className="flex items-center gap-2">
                          <History className="w-3 h-3 text-amber-400" />
                          <span className="text-[10px] font-bold text-amber-500 uppercase">Historial</span>
                          <span className="bg-amber-100 text-amber-600 text-[8px] px-1.5 py-0.5 rounded-full font-bold">
                            {historyTris.length}
                          </span>
                        </div>
                        <ChevronDown className={`w-3 h-3 text-amber-400 transition-transform ${showTrisemanaHistory ? 'rotate-180' : ''}`} />
                      </button>

                      {showTrisemanaHistory && (
                        <div className="space-y-2 mt-1 max-h-[200px] overflow-y-auto pr-1 custom-scrollbar animate-in fade-in slide-in-from-top-1">
                          {historyTris.sort((a, b) => b.startDate.localeCompare(a.startDate)).map(t => (
                            <div 
                              key={t.id}
                              className="p-2.5 bg-white border border-slate-100 rounded-xl opacity-70 hover:opacity-100 transition-all"
                            >
                              <div className="flex items-center justify-between mb-0.5">
                                <span className="text-[10px] font-bold text-slate-700 truncate max-w-[100px]">{t.name}</span>
                                <div className="flex items-center gap-1">
                                  <button 
                                    onClick={async () => {
                                      if (!user) return;
                                      try {
                                        const active = trisemanas.find(tri => tri.status === 'active');
                                        if (active) {
                                          await updateDoc(doc(db, `users/${user.uid}/trisemanas/${active.id}`), { status: 'archived' });
                                        }
                                        await updateDoc(doc(db, `users/${user.uid}/trisemanas/${t.id}`), { status: 'active' });
                                        showToast(`Trisemana "${t.name}" activada.`);
                                      } catch (error) {
                                        handleFirestoreError(error, OperationType.UPDATE, 'trisemanas');
                                      }
                                    }}
                                    className="p-0.5 text-slate-400 hover:text-amber-500 transition-colors"
                                    title="Re-activar"
                                  >
                                    <CheckCircle2 className="w-2.5 h-2.5" />
                                  </button>
                                  <button 
                                    onClick={() => openEditTrisemana(t)}
                                    className="p-0.5 text-slate-400 hover:text-indigo-500 transition-colors"
                                    title="Editar"
                                  >
                                    <Edit3 className="w-2.5 h-2.5" />
                                  </button>
                                  <button 
                                    onClick={() => deleteTrisemana(t.id)}
                                    className="p-0.5 text-slate-400 hover:text-rose-500 transition-colors"
                                    title="Eliminar"
                                  >
                                    <Trash2 className="w-2.5 h-2.5" />
                                  </button>
                                </div>
                              </div>
                              <div className="flex flex-col gap-0.5 text-[8px] text-slate-400">
                                <div className="flex items-center justify-between">
                                  <span>{t.startDate} - {t.endDate}</span>
                                  <span className="font-bold">{t.maxHours}h</span>
                                </div>
                                {(() => {
                                  const assocPeriod = periods.find(p => 
                                    (t.startDate >= p.startDate && t.startDate <= p.endDate) || 
                                    (t.endDate >= p.startDate && t.endDate <= p.endDate) ||
                                    (t.startDate <= p.startDate && t.endDate >= p.endDate)
                                  );
                                  return assocPeriod && (
                                    <div className="text-[7px] font-bold text-indigo-400/70 truncate uppercase tracking-tight">
                                      Periodo: {assocPeriod.name}
                                    </div>
                                  );
                                })()}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            </section>

            <section id="config-section" className="relative">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2 text-indigo-600">
                  <Settings className="w-4 h-4" />
                  <h2 className="text-sm font-bold uppercase tracking-widest">Valores de Contrato</h2>
                </div>
                
                {isConfigLocked ? (
                  <button 
                    onClick={handleEnableConfigEdit}
                    className="flex items-center gap-2 px-3 py-1.5 bg-amber-50 text-amber-700 border border-amber-200 rounded-xl text-[10px] font-black uppercase hover:bg-amber-100 transition-all shadow-sm"
                  >
                    <Lock className="w-3 h-3" />
                    Modificar Configuración
                  </button>
                ) : (
                  <button 
                    onClick={handleReviewConfigChanges}
                    className="flex items-center gap-2 px-3 py-1.5 bg-emerald-600 text-white rounded-xl text-[10px] font-black uppercase hover:bg-emerald-700 transition-all shadow-lg animate-pulse"
                  >
                    <Save className="w-3 h-3" />
                    Guardar Cambios
                  </button>
                )}
              </div>
              
              <p className="text-xs text-slate-500 mb-6 leading-relaxed">Configura las tarifas acordadas por hora y por paciente según tu contrato.</p>

              {!isConfigLocked && (
                <motion.div 
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mb-6 p-4 bg-indigo-50 border border-indigo-100 rounded-2xl flex items-start gap-3"
                >
                  <Info className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />
                  <div>
                    <h4 className="text-[10px] font-black text-indigo-800 uppercase">Modo Edición Activo</h4>
                    <p className="text-[10px] text-indigo-600 font-medium">Los cambios que realices afectarán inmediatamente los cálculos en pantalla, pero deben ser confirmados para guardarse permanentemente.</p>
                  </div>
                </motion.div>
              )}

              <div className={`space-y-6 transition-all ${isConfigLocked ? 'opacity-80 grayscale-[0.5] pointer-events-none select-none' : ''}`}>
                <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest">Recargos de Ley (Colombia 2026)</h3>
                    <span className="px-2 py-1 bg-emerald-100 text-emerald-700 text-[8px] font-black uppercase rounded-lg border border-emerald-200">
                      Fijos No Modificables
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-3 pb-2">
                    {[
                      { label: 'Nocturno', val: '35%' },
                      { label: 'Festivo Diurno', val: '75%' },
                      { label: 'Festivo Nocturno', val: '110%' },
                      { label: 'Extra Diurno', val: '25%' },
                      { label: 'Extra Nocturno', val: '75%' },
                      { label: 'Extra Festivo D', val: '100%' },
                      { label: 'Extra Festivo N', val: '150%' },
                    ].map((item) => (
                      <div key={item.label} className="p-2 bg-white rounded-xl border border-slate-100 shadow-sm flex flex-col items-center">
                        <span className="text-[8px] font-bold text-slate-400 uppercase">{item.label}</span>
                        <span className="text-xs font-black text-slate-800">{item.val}</span>
                      </div>
                    ))}
                  </div>
                  <p className="text-[9px] text-slate-400 italic mt-2 text-center">
                    Tarifas calculadas automáticamente según la ley vigente.
                  </p>
                </div>

                <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
                  <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4">Bases Salariales ($)</h3>
                  <div className="space-y-4">
                    {[
                      { label: 'Base Consulta (Hora)', key: 'consultation' },
                      { label: 'Base Servicio (Hora)', key: 'service' },
                      { label: 'Base AVA/Virtual (Hora)', key: 'ava' },
                    ].map((item) => (
                      <div key={item.key}>
                        <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">{item.label}</label>
                        <div className="relative">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">$</span>
                          <input 
                            type="number"
                            step="0.01"
                            value={rates.base[item.key as keyof Rates['base']] || 0}
                            disabled={isConfigLocked}
                            onChange={(e) => {
                              const val = Number(e.target.value);
                              const newBase = { ...rates.base, [item.key]: val };
                              if (item.key === 'ava') newBase.virtual = val; // Keep them in sync
                              
                              const s = rates.surcharges;
                              const updateH = (base: number) => ({
                                day: base,
                                night: Number((base * (1 + s.night)).toFixed(2)),
                                holidayDay: Number((base * (1 + s.holidayDay)).toFixed(2)),
                                holidayNight: Number((base * (1 + s.holidayNight)).toFixed(2)),
                                extraDay: Number((base * (1 + s.extraDay)).toFixed(2)),
                                extraNight: Number((base * (1 + s.extraNight)).toFixed(2)),
                                extraHolidayDay: Number((base * (1 + s.extraHolidayDay)).toFixed(2)),
                                extraHolidayNight: Number((base * (1 + s.extraHolidayNight)).toFixed(2)),
                              });

                              setRates({
                                ...rates,
                                base: newBase,
                                hourly: updateH(newBase.consultation),
                                ava: updateH(newBase.ava),
                                patient: {
                                  day: newBase.service,
                                  night: Number((newBase.service * (1 + s.night)).toFixed(2)),
                                  holidayDay: Number((newBase.service * (1 + s.holidayDay)).toFixed(2)),
                                  holidayNight: Number((newBase.service * (1 + s.holidayNight)).toFixed(2)),
                                }
                              });
                            }}
                            className={`w-full bg-white border border-slate-200 rounded-xl py-2 pl-7 pr-3 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all font-mono ${isConfigLocked ? 'bg-slate-50 cursor-not-allowed opacity-75' : ''}`}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest">Valor Horas Consulta ($)</h3>
                  </div>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-[10px] font-bold text-indigo-500 uppercase mb-1">Base Consulta (Diurna)</label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">$</span>
                        <input 
                          type="number" 
                          step="0.01"
                          value={rates.hourly.day || 0}
                          disabled={isConfigLocked}
                          onChange={(e) => {
                            const base = Number(e.target.value);
                            setRates({
                              ...rates,
                              hourly: {
                                day: base,
                                night: Number((base * (1 + rates.surcharges.night)).toFixed(2)),
                                holidayDay: Number((base * (1 + rates.surcharges.holidayDay)).toFixed(2)),
                                holidayNight: Number((base * (1 + rates.surcharges.holidayNight)).toFixed(2)),
                                extraDay: Number((base * (1 + rates.surcharges.extraDay)).toFixed(2)),
                                extraNight: Number((base * (1 + rates.surcharges.extraNight)).toFixed(2)),
                                extraHolidayDay: Number((base * (1 + rates.surcharges.extraHolidayDay)).toFixed(2)),
                                extraHolidayNight: Number((base * (1 + rates.surcharges.extraHolidayNight)).toFixed(2)),
                              }
                            });
                          }}
                          className={`w-full bg-white border border-indigo-200 rounded-xl py-2 pl-7 pr-3 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all font-mono font-bold ${isConfigLocked ? 'bg-slate-50 cursor-not-allowed opacity-75' : ''}`}
                        />
                      </div>
                      <p className="text-[9px] text-slate-400 mt-1 italic">Calcula recargos según configuración superior</p>
                    </div>

                    <div className="h-px bg-slate-200 my-2" />

                    {[
                      { label: 'Consulta Diurna', key: 'day' },
                      { label: 'Consulta Nocturna', key: 'night' },
                      { label: 'Consulta D-Festiva', key: 'holidayDay' },
                      { label: 'Consulta N-Festiva', key: 'holidayNight' },
                      { label: 'Consulta Extra Diurna', key: 'extraDay' },
                      { label: 'Consulta Extra Nocturna', key: 'extraNight' },
                      { label: 'Consulta Extra D-Festiva', key: 'extraHolidayDay' },
                      { label: 'Consulta Extra N-Festiva', key: 'extraHolidayNight' },
                    ].map((item) => (
                      <div key={item.key}>
                        <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">{item.label}</label>
                        <div className="relative">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">$</span>
                          <input 
                            type="number"
                            step="0.01"
                            value={rates.hourly[item.key as keyof Rates['hourly']] || 0}
                            disabled={isConfigLocked}
                            onChange={(e) => setRates({
                              ...rates,
                              hourly: { ...rates.hourly, [item.key]: Number(e.target.value) }
                            })}
                            className={`w-full bg-white border border-slate-200 rounded-xl py-2 pl-7 pr-3 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all font-mono ${isConfigLocked ? 'bg-slate-50 cursor-not-allowed opacity-75' : ''}`}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest">Valor Horas AVA/Virtual ($)</h3>
                  </div>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-[10px] font-bold text-indigo-500 uppercase mb-1">Base AVA/Virtual (Diurna)</label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">$</span>
                        <input 
                          type="number" 
                          step="0.01"
                          value={rates.ava.day}
                          disabled={isConfigLocked}
                          onChange={(e) => {
                            const base = Number(e.target.value);
                            setRates({
                              ...rates,
                              ava: {
                                day: base,
                                night: Number((base * (1 + rates.surcharges.night)).toFixed(2)),
                                holidayDay: Number((base * (1 + rates.surcharges.holidayDay)).toFixed(2)),
                                holidayNight: Number((base * (1 + rates.surcharges.holidayNight)).toFixed(2)),
                                extraDay: Number((base * (1 + rates.surcharges.extraDay)).toFixed(2)),
                                extraNight: Number((base * (1 + rates.surcharges.extraNight)).toFixed(2)),
                                extraHolidayDay: Number((base * (1 + rates.surcharges.extraHolidayDay)).toFixed(2)),
                                extraHolidayNight: Number((base * (1 + rates.surcharges.extraHolidayNight)).toFixed(2)),
                              }
                            });
                          }}
                          className={`w-full bg-white border border-indigo-200 rounded-xl py-2 pl-7 pr-3 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all font-mono font-bold ${isConfigLocked ? 'bg-slate-50 cursor-not-allowed opacity-75' : ''}`}
                        />
                      </div>
                      <p className="text-[9px] text-slate-400 mt-1 italic">Calcula recargos según configuración superior</p>
                    </div>

                    <div className="h-px bg-slate-200 my-2" />

                    {[
                      { label: 'AVA/Virt Diurna', key: 'day' },
                      { label: 'AVA/Virt Nocturna', key: 'night' },
                      { label: 'AVA/Virt D-Festiva', key: 'holidayDay' },
                      { label: 'AVA/Virt N-Festiva', key: 'holidayNight' },
                      { label: 'AVA/Virt Extra Diurna', key: 'extraDay' },
                      { label: 'AVA/Virt Extra Nocturna', key: 'extraNight' },
                      { label: 'AVA/Virt Extra D-Festiva', key: 'extraHolidayDay' },
                      { label: 'AVA/Virt Extra N-Festiva', key: 'extraHolidayNight' },
                    ].map((item) => (
                      <div key={item.key}>
                        <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">{item.label}</label>
                        <div className="relative">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">$</span>
                          <input 
                            type="number"
                            step="0.01"
                            value={rates.ava[item.key as keyof Rates['ava']]}
                            disabled={isConfigLocked}
                            onChange={(e) => setRates({
                              ...rates,
                              ava: { ...rates.ava, [item.key]: Number(e.target.value) }
                            })}
                            className={`w-full bg-white border border-slate-200 rounded-xl py-2 pl-7 pr-3 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all font-mono ${isConfigLocked ? 'bg-slate-50 cursor-not-allowed opacity-75' : ''}`}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
                  <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4">Valor por Pacientes ($)</h3>
                  <div className="space-y-4">
                    {[
                      { label: 'Paciente Diurno', key: 'day' },
                      { label: 'Paciente Nocturno', key: 'night' },
                      { label: 'Paciente D-Festivo', key: 'holidayDay' },
                      { label: 'Paciente N-Festivo', key: 'holidayNight' },
                    ].map((item) => (
                      <div key={item.key}>
                        <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">{item.label}</label>
                        <div className="relative">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">$</span>
                          <input 
                            type="number"
                            step="0.01"
                            value={rates.patient[item.key as keyof Rates['patient']]}
                            disabled={isConfigLocked}
                            onChange={(e) => setRates({
                              ...rates,
                              patient: { ...rates.patient, [item.key]: Number(e.target.value) }
                            })}
                            className={`w-full bg-white border border-slate-200 rounded-xl py-2 pl-7 pr-3 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all font-mono ${isConfigLocked ? 'bg-slate-50 cursor-not-allowed opacity-75' : ''}`}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest">Deducciones Adicionales ($)</h3>
                    <button 
                      onClick={addDeduction}
                      disabled={isConfigLocked}
                      className={`p-1.5 bg-indigo-100 text-indigo-600 rounded-lg hover:bg-indigo-200 transition-colors ${isConfigLocked ? 'opacity-50 cursor-not-allowed grayscale' : ''}`}
                      title="Agregar concepto de deducción"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  
                  <div className="space-y-4">
                    {additionalDeductions.length === 0 ? (
                      <p className="text-[10px] text-slate-400 italic text-center py-2">No hay deducciones adicionales registradas</p>
                    ) : (
                      additionalDeductions.map((deduction) => (
                        <div 
                          key={deduction.id} 
                          className={`p-3 border rounded-xl space-y-2 relative group transition-all ${
                            deduction.applied !== false ? 'bg-white border-slate-200 shadow-sm' : 'bg-slate-50 border-slate-100 opacity-60'
                          }`}
                        >
                          <button 
                            onClick={() => removeDeduction(deduction.id)}
                            className="absolute -top-2 -right-2 w-5 h-5 bg-rose-500 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-sm z-10"
                          >
                            <X className="w-3 h-3" />
                          </button>
                          
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex-1">
                              <label className="block text-[9px] font-bold text-slate-400 uppercase mb-1">Concepto</label>
                              <input 
                                type="text"
                                value={deduction.concept}
                                onChange={(e) => updateDeduction(deduction.id, 'concept', e.target.value)}
                                placeholder="Ej: Cooperativa"
                                className="w-full bg-slate-50 border border-slate-100 rounded-lg py-1 px-3 text-xs focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                              />
                            </div>
                            <div className="flex flex-col items-center justify-center pt-4">
                              <div className="relative inline-flex items-center cursor-pointer">
                                <input 
                                  type="checkbox" 
                                  checked={deduction.applied !== false} 
                                  onChange={(e) => updateDeduction(deduction.id, 'applied', e.target.checked)}
                                  className="sr-only peer"
                                />
                                <div className="w-8 h-4 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-emerald-500"></div>
                              </div>
                              <span className="text-[8px] font-bold text-slate-400 uppercase mt-1">
                                {deduction.applied !== false ? 'Activo' : 'Inactivo'}
                              </span>
                            </div>
                          </div>
                          
                          <div className="flex items-end gap-3">
                            <div className="flex-1">
                              <label className="block text-[9px] font-bold text-slate-400 uppercase mb-1">Monto ($)</label>
                              <div className="relative">
                                <span className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 text-[10px]">$</span>
                                <input 
                                  type="number"
                                  value={deduction.amount}
                                  disabled={isConfigLocked}
                                  onChange={(e) => updateDeduction(deduction.id, 'amount', Number(e.target.value))}
                                  className={`w-full bg-slate-50 border border-slate-100 rounded-lg py-1 pl-5 pr-3 text-xs focus:ring-2 focus:ring-indigo-500 outline-none transition-all font-mono ${isConfigLocked ? 'cursor-not-allowed opacity-75' : ''}`}
                                />
                              </div>
                            </div>
                            {results.definitive.gross > 0 && deduction.applied !== false && (
                              <div className="flex flex-col items-end pb-1">
                                <span className="text-[9px] font-bold text-rose-500 bg-rose-50 px-1.5 py-0.5 rounded border border-rose-100">
                                  - {((deduction.amount / results.definitive.gross) * 100).toFixed(1)}%
                                </span>
                              </div>
                            )}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
                  <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4">Parámetros de Extracto de Pagos (Indefinido)</h3>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Cargo / Título</label>
                      <input 
                        type="text"
                        value={rates.payroll.jobTitle || ''}
                        disabled={isConfigLocked}
                        onChange={(e) => setRates({
                          ...rates,
                          payroll: { ...rates.payroll, jobTitle: e.target.value }
                        })}
                        className={`w-full bg-white border border-slate-200 rounded-xl py-2 px-3 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all ${isConfigLocked ? 'bg-slate-50 cursor-not-allowed opacity-75' : ''}`}
                        placeholder="Ej: MEDICO CONSULTA 2 MED"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1 flex items-center gap-1">
                        Valor UVT 2026
                        <button 
                          onClick={() => setShowHelp(HELP_CONTENT.uvt)}
                          className="hover:text-indigo-600 transition-colors"
                        >
                          <Info className="w-3 h-3 text-slate-400" />
                        </button>
                      </label>
                      <input 
                        type="number"
                        value={rates.payroll.uvtValue || 0}
                        disabled={isConfigLocked}
                        onChange={(e) => setRates({
                          ...rates,
                          payroll: { ...rates.payroll, uvtValue: Number(e.target.value) }
                        })}
                        className={`w-full bg-white border border-slate-200 rounded-xl py-2 px-3 text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all font-mono ${isConfigLocked ? 'bg-slate-50 cursor-not-allowed opacity-75' : ''}`}
                      />
                    </div>
                    <div className="flex items-center justify-between p-3 bg-white border border-slate-200 rounded-xl">
                      <div className="flex flex-col">
                        <label className="text-[10px] font-bold text-slate-500 uppercase flex items-center gap-1">
                          Día de Corte de Facturación
                          <button 
                            onClick={() => setShowHelp(HELP_CONTENT.cutoff)}
                            className="hover:text-indigo-600 transition-colors"
                          >
                            <Info className="w-3 h-3 text-slate-400" />
                          </button>
                        </label>
                        <span className="text-[10px] text-slate-400">Reinicia el periodo mensual</span>
                      </div>
                      <input 
                        type="number"
                        min="1"
                        max="31"
                        value={rates.payroll.billingCutoffDay || 0}
                        disabled={isConfigLocked}
                        onChange={(e) => setRates({
                          ...rates,
                          payroll: { ...rates.payroll, billingCutoffDay: Number(e.target.value) }
                        })}
                        className={`w-16 bg-slate-50 border border-slate-200 rounded-lg py-1 px-2 text-xs text-right focus:ring-2 focus:ring-indigo-500 outline-none transition-all font-mono ${isConfigLocked ? 'bg-slate-100 cursor-not-allowed' : ''}`}
                      />
                    </div>
                    <div className="flex items-center justify-between p-3 bg-white border border-slate-200 rounded-xl">
                      <div className="flex flex-col">
                        <label className="text-[10px] font-bold text-slate-500 uppercase flex items-center gap-1">
                          ¿Tiene Dependientes?
                          <button 
                            onClick={() => setShowHelp(HELP_CONTENT.dependents)}
                            className="hover:text-indigo-600 transition-colors"
                          >
                            <Info className="w-3 h-3 text-slate-400" />
                          </button>
                        </label>
                        <span className="text-[10px] text-slate-400">Aplica deducción del 10%</span>
                      </div>
                      <input 
                        type="checkbox"
                        checked={rates.payroll.dependents}
                        disabled={isConfigLocked}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          setConfirmDialog({
                            title: 'Confirmar Dependientes',
                            message: `¿Desea ${checked ? 'activar' : 'desactivar'} la deducción por dependientes económicos (10%)?`,
                            onConfirm: () => {
                              setRates({
                                ...rates,
                                payroll: { ...rates.payroll, dependents: checked }
                              });
                              setConfirmDialog(null);
                              showToast(`Deducción por dependientes ${checked ? 'activada' : 'desactivada'}`);
                            }
                          });
                        }}
                        className={`w-5 h-5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 ${isConfigLocked ? 'cursor-not-allowed opacity-50' : ''}`}
                      />
                    </div>
                    <div className="flex items-center justify-between p-3 bg-white border border-slate-200 rounded-xl">
                      <div className="flex flex-col">
                        <label className="text-[10px] font-bold text-slate-500 uppercase flex items-center gap-1">
                          Inicio Hora Nocturna
                          <button 
                            onClick={() => setShowHelp(HELP_CONTENT.nightShift)}
                            className="hover:text-indigo-600 transition-colors"
                          >
                            <Info className="w-3 h-3 text-slate-400" />
                          </button>
                        </label>
                        <span className="text-[10px] text-slate-400">Formato 24h (ej: 19 = 7 PM)</span>
                      </div>
                      <input 
                        type="number"
                        min="0"
                        max="23"
                        value={rates.payroll.nightShiftStart || 0}
                        disabled={isConfigLocked}
                        onChange={(e) => setRates({
                          ...rates,
                          payroll: { ...rates.payroll, nightShiftStart: Number(e.target.value) }
                        })}
                        className={`w-16 bg-slate-50 border border-slate-200 rounded-lg py-1 px-2 text-xs text-right focus:ring-2 focus:ring-indigo-500 outline-none transition-all font-mono ${isConfigLocked ? 'bg-slate-100 cursor-not-allowed' : ''}`}
                      />
                    </div>
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="block text-[10px] font-bold text-slate-500 uppercase flex items-center gap-1">
                          Medicina Prepagada ($)
                          <button 
                            onClick={() => setShowHelp(HELP_CONTENT.prepagada)}
                            className="hover:text-indigo-600 transition-colors"
                          >
                            <Info className="w-3 h-3 text-slate-400" />
                          </button>
                        </label>
                        <div className="flex items-center gap-2">
                          {results.definitive.gross > 0 && rates.payroll.usePrepagada && (
                            <div className="flex flex-col items-end">
                              <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${
                                rates.payroll.prepagada > (16 * rates.payroll.uvtValue)
                                  ? 'bg-amber-50 text-amber-600 border-amber-100'
                                  : 'bg-emerald-50 text-emerald-600 border-emerald-100'
                              }`}>
                                {((Math.min(rates.payroll.prepagada, 16 * rates.payroll.uvtValue) / results.definitive.gross) * 100).toFixed(1)}%
                              </span>
                              {rates.payroll.prepagada > (16 * rates.payroll.uvtValue) && (
                                <span className="text-[7px] text-amber-500 font-bold uppercase">Tope Máx.</span>
                              )}
                            </div>
                          )}
                          <input 
                            type="checkbox"
                            checked={rates.payroll.usePrepagada}
                            disabled={isConfigLocked}
                            onChange={(e) => {
                              const checked = e.target.checked;
                              setConfirmDialog({
                                title: 'Confirmar Medicina Prepagada',
                                message: `¿Desea ${checked ? 'activar' : 'desactivar'} la deducción por Medicina Prepagada / Seguros de Salud?`,
                                onConfirm: () => {
                                  setRates(prev => ({
                                    ...prev,
                                    payroll: { ...prev.payroll, usePrepagada: checked }
                                  }));
                                  setConfirmDialog(null);
                                }
                              });
                            }}
                            className={`w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 ${isConfigLocked ? 'cursor-not-allowed opacity-50' : ''}`}
                          />
                        </div>
                      </div>
                          <input 
                            type="number"
                            value={rates.payroll.prepagada === 0 ? '' : rates.payroll.prepagada}
                            onChange={(e) => {
                              const val = e.target.value === '' ? 0 : Number(e.target.value);
                              setRates(prev => ({
                                ...prev,
                                payroll: { ...prev.payroll, prepagada: val }
                              }));
                            }}
                            disabled={!rates.payroll.usePrepagada || isConfigLocked}
                            className={`w-full bg-white border border-slate-200 rounded-xl py-2 px-3 text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all font-mono ${(!rates.payroll.usePrepagada || isConfigLocked) ? 'opacity-50 grayscale bg-slate-50 cursor-not-allowed' : ''}`}
                          />
                    </div>
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="block text-[10px] font-bold text-slate-500 uppercase flex items-center gap-1">
                          Intereses de Vivienda ($)
                          <button 
                            onClick={() => setShowHelp(HELP_CONTENT.interesesVivienda)}
                            className="hover:text-indigo-600 transition-colors"
                          >
                            <Info className="w-3 h-3 text-slate-400" />
                          </button>
                        </label>
                        <div className="flex items-center gap-2">
                          {results.definitive.gross > 0 && rates.payroll.useInteresesVivienda && (
                            <div className="flex flex-col items-end">
                              <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${
                                rates.payroll.interesesVivienda > (100 * rates.payroll.uvtValue)
                                  ? 'bg-amber-50 text-amber-600 border-amber-100'
                                  : 'bg-emerald-50 text-emerald-600 border-emerald-100'
                              }`}>
                                {((Math.min(rates.payroll.interesesVivienda, 100 * rates.payroll.uvtValue) / results.definitive.gross) * 100).toFixed(1)}%
                              </span>
                              {rates.payroll.interesesVivienda > (100 * rates.payroll.uvtValue) && (
                                <span className="text-[7px] text-amber-500 font-bold uppercase">Tope Máx.</span>
                              )}
                            </div>
                          )}
                          <input 
                            type="checkbox"
                            checked={rates.payroll.useInteresesVivienda}
                            disabled={isConfigLocked}
                            onChange={(e) => {
                              const checked = e.target.checked;
                              setConfirmDialog({
                                title: 'Confirmar Intereses Vivienda',
                                message: `¿Desea ${checked ? 'activar' : 'desactivar'} la deducción por intereses de préstamos de vivienda (UPR)?`,
                                onConfirm: () => {
                                  setRates(prev => ({
                                    ...prev,
                                    payroll: { ...prev.payroll, useInteresesVivienda: checked }
                                  }));
                                  setConfirmDialog(null);
                                }
                              });
                            }}
                            className={`w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 ${isConfigLocked ? 'cursor-not-allowed opacity-50' : ''}`}
                          />
                        </div>
                      </div>
                      <input 
                        type="number"
                        value={rates.payroll.interesesVivienda === 0 ? '' : rates.payroll.interesesVivienda}
                        onChange={(e) => {
                          const val = e.target.value === '' ? 0 : Number(e.target.value);
                          setRates(prev => ({
                            ...prev,
                            payroll: { ...prev.payroll, interesesVivienda: val }
                          }));
                        }}
                        disabled={!rates.payroll.useInteresesVivienda || isConfigLocked}
                        className={`w-full bg-white border border-slate-200 rounded-xl py-2 px-3 text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all font-mono ${(!rates.payroll.useInteresesVivienda || isConfigLocked) ? 'opacity-50 grayscale bg-slate-50 cursor-not-allowed' : ''}`}
                      />
                    </div>
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="block text-[10px] font-bold text-slate-500 uppercase flex items-center gap-1">
                          Pensión Voluntaria ($)
                          <button 
                            onClick={() => setShowHelp(HELP_CONTENT.pensionVoluntaria)}
                            className="hover:text-indigo-600 transition-colors"
                          >
                            <Info className="w-3 h-3 text-slate-400" />
                          </button>
                        </label>
                        <div className="flex items-center gap-2">
                          {results.definitive.gross > 0 && rates.payroll.usePensionVoluntaria && (
                            <div className="flex flex-col items-end">
                              <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${
                                rates.payroll.pensionVoluntaria > (results.definitive.gross * 0.3)
                                  ? 'bg-amber-50 text-amber-600 border-amber-100'
                                  : 'bg-emerald-50 text-emerald-600 border-emerald-100'
                              }`}>
                                {((Math.min(rates.payroll.pensionVoluntaria, results.definitive.gross * 0.3) / results.definitive.gross) * 100).toFixed(1)}%
                              </span>
                              {rates.payroll.pensionVoluntaria > (results.definitive.gross * 0.3) && (
                                <span className="text-[7px] text-amber-500 font-bold uppercase">Tope Máx.</span>
                              )}
                            </div>
                          )}
                          <input 
                            type="checkbox"
                            checked={rates.payroll.usePensionVoluntaria}
                            disabled={isConfigLocked}
                            onChange={(e) => {
                              const checked = e.target.checked;
                              setConfirmDialog({
                                title: 'Confirmar Pensión Voluntaria',
                                message: `¿Desea ${checked ? 'activar' : 'desactivar'} la deducción por aportes a Pensión Voluntaria?`,
                                onConfirm: () => {
                                  setRates(prev => ({
                                    ...prev,
                                    payroll: { ...prev.payroll, usePensionVoluntaria: checked }
                                  }));
                                  setConfirmDialog(null);
                                }
                              });
                            }}
                            className={`w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 ${isConfigLocked ? 'cursor-not-allowed opacity-50' : ''}`}
                          />
                        </div>
                      </div>
                      <input 
                        type="number"
                        value={rates.payroll.pensionVoluntaria === 0 ? '' : rates.payroll.pensionVoluntaria}
                        onChange={(e) => {
                          const val = e.target.value === '' ? 0 : Number(e.target.value);
                          setRates(prev => ({
                            ...prev,
                            payroll: { ...prev.payroll, pensionVoluntaria: val }
                          }));
                        }}
                        disabled={!rates.payroll.usePensionVoluntaria || isConfigLocked}
                        className={`w-full bg-white border border-slate-200 rounded-xl py-2 px-3 text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all font-mono ${(!rates.payroll.usePensionVoluntaria || isConfigLocked) ? 'opacity-50 grayscale bg-slate-50 cursor-not-allowed' : ''}`}
                      />
                    </div>
                    <div className="h-px bg-slate-200 my-2" />

                    <div className="h-px bg-slate-200 my-2" />
                    <div className="space-y-2">
                       <label className="block text-[10px] font-bold text-slate-500 uppercase flex items-center gap-1">
                          Modalidad de Retención en la Fuente
                          <button 
                            onClick={() => setShowHelp(HELP_CONTENT.retefuente)}
                            className="hover:text-indigo-600 transition-colors"
                          >
                            <Info className="w-3 h-3 text-slate-400" />
                          </button>
                       </label>
                       
                       <div className="grid grid-cols-2 gap-2 p-1 bg-slate-100 rounded-xl">
                          <button
                            onClick={() => {
                              if (rates.payroll.useManualRetefuente) {
                                setConfirmDialog({
                                  title: 'Cambiar a Retención de Ley',
                                  message: '¿Desea volver al cálculo automático basado en la normativa legal (Art. 383 E.T.)?',
                                  confirmLabel: 'Sí, Automático',
                                  onConfirm: () => {
                                    setRates(prev => ({
                                      ...prev,
                                      payroll: { ...prev.payroll, useManualRetefuente: false }
                                    }));
                                    setConfirmDialog(null);
                                    showToast("Cálculo automático de retención activado.");
                                  }
                                });
                              }
                            }}
                            className={`py-2 text-[10px] font-bold rounded-lg transition-all ${!rates.payroll.useManualRetefuente ? 'bg-white text-indigo-600 shadow-sm shadow-indigo-100' : 'text-slate-400 hover:bg-slate-200'}`}
                          >
                             AUTOMÁTICO (LEY)
                          </button>
                          <button
                            onClick={() => {
                              if (!rates.payroll.useManualRetefuente) {
                                setConfirmDialog({
                                  title: 'Cambiar a Retención Manual',
                                  message: '¿Desea fijar un porcentaje de retención personalizado de forma manual?',
                                  confirmLabel: 'Sí, Manual',
                                  onConfirm: () => {
                                    setRates(prev => ({
                                      ...prev,
                                      payroll: { ...prev.payroll, useManualRetefuente: true }
                                    }));
                                    setConfirmDialog(null);
                                    showToast("Configura el porcentaje deseado.", 'info');
                                  }
                                });
                              }
                            }}
                            className={`py-2 text-[10px] font-bold rounded-lg transition-all ${rates.payroll.useManualRetefuente ? 'bg-rose-500 text-white shadow-sm shadow-rose-200' : 'text-slate-400 hover:bg-slate-200'}`}
                          >
                             MANUAL (FIJO %)
                          </button>
                       </div>

                       <AnimatePresence mode="wait">
                          {rates.payroll.useManualRetefuente ? (
                            <motion.div 
                              initial={{ opacity: 0, y: -10 }}
                              animate={{ opacity: 1, y: 0 }}
                              exit={{ opacity: 0, y: -10 }}
                              className="relative"
                            >
                               <span className="block text-[8px] font-bold text-rose-500 uppercase mb-1">Ingresa el % de Retención Fijo</span>
                               <input 
                                 type="number"
                                 step="0.01"
                                 value={rates.payroll.manualRetefuentePct}
                                 disabled={isConfigLocked}
                                 onBlur={(e) => {
                                   const val = Math.max(0, Number(e.target.value));
                                   if (val !== rates.payroll.manualRetefuentePct) {
                                     setConfirmDialog({
                                       title: 'Confirmar Nuevo Porcentaje',
                                       message: `¿Está seguro de que desea registrar ${val}% como nuevo valor fijo de retención?`,
                                       confirmLabel: 'Confirmar %',
                                       onConfirm: () => {
                                         setRates(prev => ({
                                           ...prev,
                                           payroll: { ...prev.payroll, manualRetefuentePct: val }
                                         }));
                                         setConfirmDialog(null);
                                         showToast(`Retención fijada en ${val}%`, 'success');
                                       }
                                     });
                                   }
                                 }}
                                 className={`w-full bg-white border border-rose-200 rounded-xl py-3 pl-4 pr-10 text-lg focus:ring-2 focus:ring-rose-500 outline-none transition-all font-mono font-black text-rose-700 ${isConfigLocked ? 'opacity-50 grayscale bg-slate-50 cursor-not-allowed' : ''}`}
                               />
                               <span className="absolute right-4 bottom-3 text-rose-400 font-black text-xl">%</span>
                            </motion.div>
                          ) : (
                            <motion.div 
                              initial={{ opacity: 0, y: -10 }}
                              animate={{ opacity: 1, y: 0 }}
                              exit={{ opacity: 0, y: -10 }}
                              className="bg-emerald-50 border border-emerald-100 rounded-xl p-3"
                            >
                               <div className="flex items-center gap-2 mb-1">
                                  <ShieldCheck className="w-3 h-3 text-emerald-500" />
                                  <span className="text-[9px] font-black text-emerald-600 uppercase">Cálculo según Art. 383 E.T.</span>
                               </div>
                               <p className="text-[8px] text-emerald-500 leading-tight">
                                  Se aplica la tabla progresiva de la DIAN descontando deducciones de ley, renta exenta y topes permitidos.
                               </p>
                            </motion.div>
                          )}
                       </AnimatePresence>
                    </div>

                    <div>
                      <label className="block text-[10px] font-bold text-indigo-500 uppercase mb-1 flex items-center gap-1">
                        Promedio Vacaciones (12 Meses)
                        <button 
                          onClick={() => setShowHelp(HELP_CONTENT.avgBilling)}
                          className="hover:text-indigo-600 transition-colors"
                        >
                          <Info className="w-3 h-3 text-indigo-400" />
                        </button>
                      </label>
                      <div className="w-full bg-indigo-50 border border-indigo-100 rounded-xl py-2 px-3 text-sm font-mono text-indigo-700 flex items-center justify-between">
                        <span>{formatCurrency(results.all.avg12)}</span>
                        <button
                          disabled={isConfigLocked}
                          onClick={() => {
                            const today = new Date().toISOString().split('T')[0];
                            setRates({
                              ...rates,
                              payroll: { ...rates.payroll, vacationLastResetDate: today }
                            });
                            showToast("Ciclo de vacaciones reiniciado correctamente");
                          }}
                          className={`text-[9px] bg-indigo-600 text-white px-2 py-1 rounded-lg hover:bg-indigo-700 transition-colors uppercase font-bold ${isConfigLocked ? 'opacity-50 cursor-not-allowed grayscale' : ''}`}
                        >
                          Reiniciar Ciclo
                        </button>
                      </div>
                      <p className="text-[9px] text-indigo-400 mt-1 italic flex items-center justify-between">
                        <span>
                          {rates.payroll.vacationLastResetDate 
                            ? `Entregado el: ${rates.payroll.vacationLastResetDate}` 
                            : "Cálculo automático (12 meses)"}
                        </span>
                        {rates.payroll.vacationLastResetDate && (
                          <button
                            disabled={isConfigLocked}
                            onClick={() => {
                              setRates({
                                ...rates,
                                payroll: { ...rates.payroll, vacationLastResetDate: null }
                              });
                              showToast("Cálculo de vacaciones vuelto a automático");
                            }}
                            className={`text-indigo-600 hover:underline font-bold ${isConfigLocked ? 'opacity-50 cursor-not-allowed' : ''}`}
                          >
                            Limpiar
                          </button>
                        )}
                      </p>
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-indigo-500 uppercase mb-1 flex items-center gap-1">
                        Prima Semestral (6 Meses)
                        <button 
                          onClick={() => setShowHelp(HELP_CONTENT.avgBilling)}
                          className="hover:text-indigo-600 transition-colors"
                        >
                          <Info className="w-3 h-3 text-indigo-400" />
                        </button>
                      </label>
                      <div className="w-full bg-indigo-50 border border-indigo-100 rounded-xl py-2 px-3 text-sm font-mono text-indigo-700 flex items-center justify-between">
                        <span>{formatCurrency(results.all.primaSemestral)}</span>
                        <button
                          disabled={isConfigLocked}
                          onClick={() => {
                            const today = new Date().toISOString().split('T')[0];
                            setRates({
                              ...rates,
                              payroll: { ...rates.payroll, primaLastResetDate: today }
                            });
                            showToast("Ciclo de prima reiniciado correctamente");
                          }}
                          className={`text-[9px] bg-indigo-600 text-white px-2 py-1 rounded-lg hover:bg-indigo-700 transition-colors uppercase font-bold ${isConfigLocked ? 'opacity-50 cursor-not-allowed grayscale' : ''}`}
                        >
                          Reiniciar Ciclo
                        </button>
                      </div>
                      <p className="text-[9px] text-indigo-400 mt-1 italic flex items-center justify-between">
                        <span>
                          {rates.payroll.primaLastResetDate 
                            ? `Entregado el: ${rates.payroll.primaLastResetDate}` 
                            : "Cálculo promedio (últimos 6 meses)"}
                        </span>
                        {rates.payroll.primaLastResetDate && (
                          <button
                            disabled={isConfigLocked}
                            onClick={() => {
                              setRates({
                                ...rates,
                                payroll: { ...rates.payroll, primaLastResetDate: null }
                              });
                              showToast("Cálculo de prima vuelto a automático");
                            }}
                            className={`text-indigo-600 hover:underline font-bold ${isConfigLocked ? 'opacity-50 cursor-not-allowed' : ''}`}
                          >
                            Limpiar
                          </button>
                        )}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            <section className="pt-6 border-t border-slate-100">
              <div className="flex items-center gap-2 mb-4 text-indigo-600">
                <FolderOpen className="w-4 h-4" />
                <h2 className="text-sm font-bold uppercase tracking-widest">Extractos Guardados</h2>
              </div>
              
              {savedCalculations.length === 0 ? (
                <div className="bg-slate-50 p-4 rounded-2xl border border-dashed border-slate-200 text-center">
                  <p className="text-[10px] text-slate-400 uppercase font-bold">No hay guardadas</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {savedCalculations.map((saved) => (
                    <div 
                      key={saved.id}
                      className="group bg-white border border-slate-200 rounded-2xl p-3 hover:border-indigo-300 hover:shadow-sm transition-all cursor-pointer"
                      onClick={() => loadCalculation(saved)}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <FileText className="w-3 h-3 text-slate-400 shrink-0" />
                          <span className="text-xs font-bold text-slate-700 truncate">{saved.name}</span>
                        </div>
                        <button 
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteSavedCalculation(saved.id);
                          }}
                          className="p-1 text-slate-300 hover:text-rose-500 transition-colors"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                      <div className="mt-1 text-[9px] text-slate-400 font-medium">{saved.timestamp}</div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        </aside>

        {/* Main Content */}
        <main className="flex-1 p-4 md:p-8 lg:p-10 space-y-8 md:space-y-10 max-w-5xl mx-auto w-full overflow-x-hidden safe-bottom">
          {/* Step 2: Period and Register Shift */}
          <section ref={registrationRef} className="space-y-6">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 shrink-0 rounded-full bg-slate-800 text-white flex items-center justify-center font-bold text-sm">2</div>
              <h2 className="text-lg md:text-xl font-bold text-slate-800">Periodo y Registro de Turnos</h2>
            </div>

            {/* Period Status Banner */}
            {selectedPeriodId && (
              <div className={`p-4 md:p-6 rounded-3xl border shadow-sm flex flex-col md:flex-row items-center justify-between gap-4 ${
                periods.find(p => p.id === selectedPeriodId)?.status === 'active' 
                  ? 'bg-white border-slate-200' 
                  : 'bg-amber-50 border-amber-200'
              }`}>
                <div className="flex items-center gap-4 w-full md:w-auto">
                  <div className={`p-3 rounded-2xl shrink-0 ${
                    periods.find(p => p.id === selectedPeriodId)?.status === 'active' 
                      ? 'bg-indigo-100 text-indigo-600' 
                      : 'bg-amber-100 text-amber-600'
                  }`}>
                    <Calendar className="w-6 h-6" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <input 
                        key={selectedPeriodId}
                        type="text"
                        defaultValue={periods.find(p => p.id === selectedPeriodId)?.name}
                        onBlur={(e) => updatePeriodName(selectedPeriodId, e.target.value)}
                        className="text-base md:text-lg font-bold text-slate-800 bg-transparent border-b border-transparent hover:border-slate-300 focus:border-indigo-500 focus:ring-0 outline-none transition-all px-1 truncate w-full"
                      />
                      <span className={`px-2 py-0.5 rounded-full text-[8px] md:text-[10px] font-bold uppercase tracking-wider shrink-0 ${
                        periods.find(p => p.id === selectedPeriodId)?.status === 'active' 
                          ? 'bg-emerald-100 text-emerald-700' 
                          : 'bg-amber-200 text-amber-800'
                      }`}>
                        {periods.find(p => p.id === selectedPeriodId)?.status === 'active' ? 'Activo' : 'Archivado'}
                      </span>
                    </div>
                    <p className="text-xs md:text-sm text-slate-500 truncate">
                      Rango: <span className="font-bold">{periods.find(p => p.id === selectedPeriodId)?.startDate}</span> al <span className="font-bold">{periods.find(p => p.id === selectedPeriodId)?.endDate}</span>
                    </p>
                  </div>
                </div>

                {periods.find(p => p.id === selectedPeriodId)?.status === 'active' ? (
                  <button 
                    onClick={() => openEditPeriod(periods.find(p => p.id === selectedPeriodId)!)}
                    className="w-full md:w-auto px-5 py-3 bg-slate-800 text-white text-xs font-bold rounded-xl hover:bg-slate-700 active:scale-95 transition-all flex items-center justify-center gap-2 shadow-md"
                  >
                    <Archive className="w-4 h-4" />
                    Configurar Periodo
                  </button>
                ) : (
                  <div className="flex flex-col md:flex-row items-center gap-3 bg-white/50 p-3 rounded-2xl border border-amber-200/50 w-full md:w-auto">
                    <div className="flex items-center gap-2 w-full md:w-auto">
                      <Info className="w-4 h-4 text-amber-600 shrink-0" />
                      <p className="text-xs text-amber-800 font-medium">Este periodo está archivado.</p>
                    </div>
                    <div className="grid grid-cols-2 lg:flex items-center gap-2 w-full md:w-auto">
                      <button 
                        onClick={() => reactivatePeriod(selectedPeriodId)}
                        className="px-3 py-2.5 bg-indigo-600 text-white text-[9px] font-bold rounded-xl hover:bg-indigo-700 active:scale-95 transition-all flex items-center justify-center gap-2 shadow-sm"
                      >
                        <RotateCcw className="w-3 h-3" />
                        Reactivar
                      </button>
                      <button 
                        onClick={updatePeriodTotalGross}
                        className="px-3 py-2.5 bg-amber-600 text-white text-[9px] font-bold rounded-xl hover:bg-amber-700 active:scale-95 transition-all flex items-center justify-center gap-2 shadow-sm"
                      >
                        <Save className="w-3 h-3" />
                        Actualizar
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
            
          {/* Summary Stats - Scrollable on mobile */}
          <div className="flex overflow-x-auto no-scrollbar gap-2 pb-2 -mx-4 px-4 md:mx-0 md:px-0">
            <div className="bg-white p-3 md:p-4 rounded-2xl border border-slate-200 shadow-sm min-w-[140px] flex-1">
              <div className="flex items-center gap-2 text-slate-500 mb-1">
                <Clock className="w-3 h-3" />
                <span className="text-[10px] font-bold uppercase tracking-wider">H. Ordinarias</span>
              </div>
              <p className="text-xl font-bold text-slate-800 font-mono">{results.all.totalRegularHours.toFixed(1)}h</p>
            </div>
            {results.all.totalExtraHours > 0 && (
              <div className="bg-amber-50 p-3 md:p-4 rounded-2xl border border-amber-200 shadow-sm min-w-[140px] flex-1">
                <div className="flex items-center gap-2 text-amber-600 mb-1">
                  <TrendingUp className="w-3 h-3" />
                  <span className="text-[10px] font-bold uppercase tracking-wider">H. Extras</span>
                </div>
                <p className="text-xl font-bold text-amber-900 font-mono">{results.all.totalExtraHours.toFixed(1)}h</p>
              </div>
            )}
            <div className="bg-indigo-50 p-3 md:p-4 rounded-2xl border border-indigo-200 shadow-sm min-w-[140px] flex-1">
              <div className="flex items-center gap-2 text-indigo-600 mb-1">
                <Wallet className="w-3 h-3" />
                <span className="text-[10px] font-bold uppercase tracking-wider">Caja Proyectada</span>
              </div>
              <p className="text-xl font-bold text-indigo-900 font-mono">{formatCurrency(results.all.netCash)}</p>
            </div>
          </div>

          <div className="bg-white p-4 md:p-6 rounded-3xl border border-slate-200 shadow-sm space-y-6 transition-all">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2 text-indigo-600">
                  <FilePlus className="w-5 h-5" />
                  <h3 className="text-sm font-bold uppercase tracking-wider">Registrar Turno</h3>
                </div>
              </div>
              <div className="flex items-start gap-3 bg-blue-50 p-4 rounded-2xl text-blue-700 text-sm leading-relaxed">
                <Info className="w-5 h-5 shrink-0 mt-0.5" />
                <p>Configura los intervalos. Las horas se calcularán automáticamente.</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 md:gap-6">
                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider">Fecha</label>
                      <input 
                        type="date" 
                        value={shift.date || ''}
                        onChange={(e) => {
                          setShift({ ...shift, date: e.target.value });
                          setFormTouched(true);
                        }}
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                      />
                  </div>
                  <div className="space-y-2">
                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider">Trisemana (Periodo)</label>
                    <select 
                      value={manualTrisemanaId || ""}
                      onChange={(e) => {
                        setManualTrisemanaId(e.target.value || null);
                        setFormTouched(true);
                      }}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-sm focus:ring-2 focus:ring-amber-500 outline-none transition-all font-bold text-slate-700"
                    >
                      <option value="">Auto-detectar por fecha</option>
                      {trisemanas.map(t => (
                        <option key={t.id} value={t.id}>{t.name} ({t.startDate})</option>
                      ))}
                    </select>
                    {(() => {
                      const t = manualTrisemanaId 
                        ? trisemanas.find(tri => tri.id === manualTrisemanaId)
                        : trisemanas.find(tri => shift.date >= tri.startDate && shift.date <= tri.endDate);
                      return t ? (
                        <div className="flex items-center gap-1.5 px-2 py-1 bg-amber-50 border border-amber-100 rounded-lg">
                          <Clock className="w-3 h-3 text-amber-600" />
                          <span className="text-[10px] font-bold text-amber-700 uppercase truncate">{t.name}</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5 px-2 py-1 bg-rose-50 border border-rose-100 rounded-lg animate-pulse">
                          <AlertCircle className="w-3 h-3 text-rose-500" />
                          <span className="text-[10px] font-bold text-rose-600 uppercase">Sin Trisemana</span>
                        </div>
                      );
                    })()}
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider">Hora de Inicio (24h)</label>
                  <input 
                    type="time" 
                    value={shift.startTime}
                    onChange={(e) => {
                      setShift({ ...shift, startTime: e.target.value });
                      setFormTouched(true);
                    }}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                  />
                  <label className="flex items-center gap-2 cursor-pointer group">
                    <input 
                      type="checkbox" 
                      checked={shift.isHolidayStart}
                      onChange={(e) => {
                        setShift({ ...shift, isHolidayStart: e.target.checked });
                        setFormTouched(true);
                      }}
                      className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    <span className="text-xs text-slate-600 group-hover:text-slate-900 transition-colors">¿Inicio en Festivo?</span>
                  </label>
                </div>

                <div className="space-y-2">
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider">Hora de Fin (24h)</label>
                  <input 
                    type="time" 
                    value={shift.endTime}
                    onChange={(e) => {
                      setShift({ ...shift, endTime: e.target.value });
                      setFormTouched(true);
                    }}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                  />
                  <label className="flex items-center gap-2 cursor-pointer group">
                    <input 
                      type="checkbox" 
                      checked={shift.isHolidayEnd}
                      onChange={(e) => {
                        setShift({ ...shift, isHolidayEnd: e.target.checked });
                        setFormTouched(true);
                      }}
                      className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    <span className="text-xs text-slate-600 group-hover:text-slate-900 transition-colors">¿Fin en Festivo?</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer group pt-2 border-t border-slate-100 mt-2">
                    <input 
                      type="checkbox" 
                      checked={shift.isAdditionalShift}
                      onChange={(e) => {
                        setShift({ ...shift, isAdditionalShift: e.target.checked });
                        setFormTouched(true);
                      }}
                      className="w-4 h-4 rounded border-amber-300 text-amber-600 focus:ring-amber-500"
                    />
                    <span className="text-xs font-bold text-amber-600 group-hover:text-amber-700 transition-colors uppercase">Turno Adicional (Amarillo)</span>
                  </label>
                </div>

                <div className="lg:col-span-2 flex flex-col justify-center bg-slate-50 rounded-2xl border border-dashed border-slate-200 p-4">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Atribución de Horas</span>
                    <div className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase ${shift.isAVAShift ? 'bg-amber-100 text-amber-700' : 'bg-indigo-100 text-indigo-700'}`}>
                      {shift.isAVAShift ? 'AVA/Virtual' : 'Consulta'}
                    </div>
                  </div>
                  
                  <div className="flex gap-2 mb-4">
                    {[
                      { id: 'consultation', label: 'Consulta', icon: Users, color: 'indigo' },
                      { id: 'avaVirtual', label: 'AVA/Virtual', icon: TrendingUp, color: 'amber' },
                    ].map((type) => (
                      <button
                        key={type.id}
                        onClick={() => {
                          setFormTouched(true);
                          setShift({ 
                            ...shift, 
                            isAVAShift: type.id === 'avaVirtual',
                            isVirtualShift: false,
                            extraHoursType: type.id as 'consultation' | 'avaVirtual'
                          });
                          if (type.id !== 'consultation') {
                            setQuantities(prev => ({ 
                              ...prev, 
                              applyPatients: false,
                              patients: { day: 0, night: 0, holidayDay: 0, holidayNight: 0 }
                            }));
                          }
                        }}
                        className={`flex-1 flex flex-col items-center justify-center gap-2 py-3 px-2 rounded-2xl text-xs font-bold uppercase transition-all border-2 ${
                          (type.id === 'consultation' && !shift.isAVAShift) ||
                          (type.id === 'avaVirtual' && shift.isAVAShift)
                            ? type.id === 'consultation' 
                              ? 'bg-indigo-600 text-white border-indigo-600 shadow-md scale-[1.02]' 
                              : 'bg-amber-500 text-white border-amber-500 shadow-md scale-[1.02]'
                            : 'bg-white text-slate-400 border-slate-100 hover:border-slate-200'
                        }`}
                      >
                        <type.icon className="w-5 h-5" />
                        {type.label}
                      </button>
                    ))}
                  </div>

                  <div className="grid grid-cols-2 gap-x-6 gap-y-2 bg-white/50 p-3 rounded-xl border border-slate-100">
                    <div className="text-[10px] font-bold text-slate-400 uppercase">Diurnas: <span className={`${shift.isAVAShift ? 'text-amber-600' : 'text-indigo-600'} font-mono text-sm ml-1`}>{shift.isAVAShift ? quantities.ava.day : quantities.hours.day}h</span></div>
                    <div className="text-[10px] font-bold text-slate-400 uppercase">Nocturnas: <span className={`${shift.isAVAShift ? 'text-amber-600' : 'text-indigo-600'} font-mono text-sm ml-1`}>{shift.isAVAShift ? quantities.ava.night : quantities.hours.night}h</span></div>
                    <div className="text-[10px] font-bold text-slate-400 uppercase">D-Fest: <span className={`${shift.isAVAShift ? 'text-amber-600' : 'text-indigo-600'} font-mono text-sm ml-1`}>{shift.isAVAShift ? quantities.ava.holidayDay : quantities.hours.holidayDay}h</span></div>
                    <div className="text-[10px] font-bold text-slate-400 uppercase">N-Fest: <span className={`${shift.isAVAShift ? 'text-amber-600' : 'text-indigo-600'} font-mono text-sm ml-1`}>{shift.isAVAShift ? quantities.ava.holidayNight : quantities.hours.holidayNight}h</span></div>
                    {/* {((shift.isAVAShift) ? (quantities.ava.extraDay + ...)} */}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                {/* Hours Adjustment */}
                <div className="space-y-4">
                  <div className="flex items-center gap-2 text-indigo-600">
                    <Clock className="w-4 h-4" />
                    <h3 className="text-sm font-bold">Ajuste de Horas</h3>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    {[
                      { label: 'Diurnas', key: 'day' },
                      { label: 'Nocturnas', key: 'night' },
                      { label: 'D-Fest', key: 'holidayDay' },
                      { label: 'N-Fest', key: 'holidayNight' },
                    ].map((item) => (
                      <div key={item.key}>
                        <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">{item.label}</label>
                        <input 
                          type="number"
                          step="0.5"
                          disabled={shift.isAVAShift}
                          value={quantities.hours[item.key as keyof Quantities['hours']] || 0}
                          onChange={(e) => {
                            setQuantities({
                              ...quantities,
                              hours: { ...quantities.hours, [item.key]: Number(e.target.value) }
                            });
                            setFormTouched(true);
                          }}
                          className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2 text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all font-mono disabled:opacity-50"
                        />
                      </div>
                    ))}
                  </div>
                </div>

                {/* AVA Adjustment */}
                <div className="space-y-4">
                  <div className="flex items-center gap-2 text-indigo-600">
                    <TrendingUp className="w-4 h-4" />
                    <h3 className="text-sm font-bold">Ajuste Horas AVA/Virtual</h3>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    {[
                      { label: 'AVA/Virt Diurnas', key: 'day' },
                      { label: 'AVA/Virt Nocturnas', key: 'night' },
                      { label: 'AVA/Virt D-Fest', key: 'holidayDay' },
                      { label: 'AVA/Virt N-Fest', key: 'holidayNight' },
                    ].map((item) => (
                      <div key={item.key}>
                        <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">{item.label}</label>
                        <input 
                          type="number"
                          step="0.5"
                          value={quantities.ava[item.key as keyof Quantities['ava']] || 0}
                          onChange={(e) => {
                            setQuantities({
                              ...quantities,
                              ava: { ...quantities.ava, [item.key]: Number(e.target.value) }
                            });
                            setFormTouched(true);
                          }}
                          className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2 text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all font-mono"
                        />
                      </div>
                    ))}
                  </div>
                </div>

                {/* Patients Adjustment */}
                <div className="flex flex-col gap-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-indigo-600">
                      <Users className="w-4 h-4" />
                      <h3 className="text-sm font-bold">Pacientes Atendidos</h3>
                    </div>
                    <div className="flex items-center gap-4">
                      <label className={`flex items-center gap-2 cursor-pointer`}>
                        <input 
                          type="checkbox" 
                          checked={autoCalculatePatients}
                          onChange={(e) => {
                            setAutoCalculatePatients(e.target.checked);
                            setFormTouched(true);
                          }}
                          className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                        />
                        <span className="text-[10px] font-bold text-slate-500 uppercase">Auto-calcular</span>
                      </label>
                      <label className={`flex items-center gap-2 ${shift.isAVAShift ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}>
                        <input 
                          type="checkbox" 
                          checked={quantities.applyPatients}
                          disabled={shift.isAVAShift}
                          onChange={(e) => {
                            const checked = e.target.checked;
                            setFormTouched(true);
                            setQuantities(prev => ({ 
                              ...prev, 
                              applyPatients: checked,
                              patients: (checked && autoCalculatePatients) ? (shift.isAVAShift ? { ...prev.ava } : { ...prev.hours }) : prev.patients
                            }));
                          }}
                          className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                        />
                        <span className="text-xs text-slate-600">Aplica cobro</span>
                      </label>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    {[
                      { label: 'Diurnos', key: 'day' },
                      { label: 'Nocturnos', key: 'night' },
                      { label: 'D-Fest', key: 'holidayDay' },
                      { label: 'N-Fest', key: 'holidayNight' },
                    ].map((item) => (
                      <div key={item.key}>
                        <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">{item.label}</label>
                        <input 
                          type="number"
                          disabled={!quantities.applyPatients}
                          value={quantities.patients[item.key as keyof Quantities['patients']] || 0}
                          onChange={(e) => {
                            setAutoCalculatePatients(false);
                            setFormTouched(true);
                            setQuantities({
                              ...quantities,
                              patients: { ...quantities.patients, [item.key]: Number(e.target.value) }
                            });
                          }}
                          className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2 text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all font-mono disabled:opacity-50"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-4">
                {editingId && (
                  <button 
                    onClick={() => {
                      setEditingId(null);
                      setShift({
                        date: new Date().toISOString().split('T')[0],
                        startTime: '07:00',
                        endTime: '19:00',
                        isHolidayStart: false,
                        isHolidayEnd: false,
                        isAVAShift: false,
                        isVirtualShift: false,
                        isExtraShift: false,
                        isAdditionalShift: false,
                        extraHoursType: 'consultation',
                      });
                      setQuantities({
                        hours: { day: 0, night: 0, holidayDay: 0, holidayNight: 0, extraDay: 0, extraNight: 0, extraHolidayDay: 0, extraHolidayNight: 0 },
                        ava: { day: 0, night: 0, holidayDay: 0, holidayNight: 0, extraDay: 0, extraNight: 0, extraHolidayDay: 0, extraHolidayNight: 0 },
                        patients: { day: 0, night: 0, holidayDay: 0, holidayNight: 0 },
                        applyPatients: true,
                      });
                    }}
                    className="flex-1 bg-slate-200 text-slate-700 font-bold py-4 rounded-2xl hover:bg-slate-300 transition-all"
                  >
                    Cancelar Edición
                  </button>
                )}
                <button 
                  onClick={addRecord}
                  disabled={periods.find(p => p.id === selectedPeriodId)?.status !== 'active' && !viewingArchive}
                  className={`flex-[2] ${editingId ? 'bg-amber-500 hover:bg-amber-600' : 'bg-indigo-600 hover:bg-indigo-700'} text-white font-bold py-4 rounded-2xl shadow-lg transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed`}
                >
                  <Calculator className="w-5 h-5" />
                  {editingId ? 'Actualizar Registro' : 'Agregar a la Bitácora'}
                </button>
              </div>
              {periods.find(p => p.id === selectedPeriodId)?.status !== 'active' && !viewingArchive && (
                <p className="text-center text-xs text-amber-600 font-bold bg-amber-50 p-2 rounded-xl border border-amber-100">
                  Este periodo está archivado. Reactívalo para agregar nuevos turnos.
                </p>
              )}
            </div>
          </section>

          {/* Step 3: Log (Bitácora) */}
          <section className="space-y-6">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-slate-800 text-white flex items-center justify-center font-bold text-sm">3</div>
                  <h2 className="text-xl font-bold text-slate-800">
                    {viewingArchive ? `Extracto: ${viewingArchive.name}` : 'Bitácora de Turnos'}
                  </h2>
                </div>
                {selectedRecordIds.length > 0 && (
                  <button 
                    onClick={deleteSelectedRecords}
                    className="px-4 py-2 bg-rose-600 text-white text-xs font-bold rounded-xl hover:bg-rose-700 transition-all flex items-center gap-2 shadow-lg shadow-rose-100"
                  >
                    <Trash2 className="w-4 h-4" />
                    Eliminar Seleccionados ({selectedRecordIds.length})
                  </button>
                )}
              </div>

            {!viewingArchive && selectedPeriodId && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
                        <Clock className="w-5 h-5" />
                      </div>
                      <div>
                        <h3 className="text-sm font-bold text-slate-800">Límite de Horas Ordinarias</h3>
                        <p className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">
                          {trisemanas.some(t => {
                            const p = periods.find(per => per.id === selectedPeriodId);
                            return p && ((t.startDate >= p.startDate && t.startDate <= p.endDate) || (t.endDate >= p.startDate && t.endDate <= p.endDate));
                          }) 
                            ? "Usando límites de Trisemana configurados" 
                            : "Define cuándo se activan los recargos por horas extra"}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="relative flex items-center gap-2">
                        <input 
                          type="number" 
                          value={periods.find(p => p.id === selectedPeriodId)?.extraThreshold || 0}
                          onChange={(e) => updatePeriodThreshold(Number(e.target.value))}
                          className="w-24 bg-slate-50 border border-slate-200 rounded-xl py-2 px-3 text-sm font-mono text-center focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                          placeholder="0"
                        />
                        <span className="text-[10px] font-bold text-slate-400 uppercase">Horas</span>
                      </div>
                    </div>
                  </div>
                  
                  {/* Active Trisemanas in this period */}
                  {(() => {
                    const p = periods.find(per => per.id === selectedPeriodId);
                    if (!p) return null;
                    const activeTris = trisemanas.filter(t => 
                      (t.startDate >= p.startDate && t.startDate <= p.endDate) || 
                      (t.endDate >= p.startDate && t.endDate <= p.endDate) ||
                      (t.startDate <= p.startDate && t.endDate >= p.endDate)
                    );
                    if (activeTris.length === 0) return null;
                    return (
                      <div className="mt-4 pt-4 border-t border-slate-100 space-y-2">
                        <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Trisemanas en este periodo</p>
                        <div className="flex flex-wrap gap-2">
                          {activeTris.map(t => (
                            <div key={t.id} className="px-2 py-1 bg-amber-50 border border-amber-100 rounded-lg text-[9px] font-bold text-amber-700">
                              {t.name}: {t.maxHours}h
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })()}
                </div>

                <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
                  <div className="flex items-center justify-between mb-4">
                    <div className="space-y-1">
                      <h3 className="text-sm font-bold text-slate-800">Resumen de Horas</h3>
                      <p className="text-[10px] text-slate-400">Discriminación por Trisemana en este periodo</p>
                    </div>
                  </div>

                  <div className="space-y-4">
                    {/* Global Totals */}
                    <div className="flex flex-wrap items-center gap-6 pb-4 border-b border-slate-100">
                      <div className="bg-indigo-600 px-4 py-3 rounded-2xl text-white shadow-lg shadow-indigo-200">
                        <p className="text-[10px] opacity-80 uppercase font-black tracking-widest mb-1">Total Consolidado</p>
                        <p className="text-2xl font-mono font-black">
                          {results.all.totalMonthlyHours.toFixed(1)}h
                        </p>
                      </div>
                      <div className="flex gap-6">
                        <div>
                          <p className="text-[9px] text-slate-400 uppercase font-bold">Ordinarias</p>
                          <p className="text-lg font-mono font-bold text-indigo-600">
                            {results.all.totalRegularHours.toFixed(1)}h
                          </p>
                        </div>
                        <div className="w-px h-8 bg-slate-100" />
                        <div>
                          <p className="text-[9px] text-slate-400 uppercase font-bold">Excedentes</p>
                          <p className="text-lg font-mono font-bold text-amber-600">
                            {results.all.totalExtraHours.toFixed(1)}h
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Trisemana Breakdown */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {Object.values(results.all.trisemanaBreakdown).map((tri: any, idx) => (
                        <div key={idx} className="bg-slate-50 p-3 rounded-2xl border border-slate-100">
                          <div className="flex items-center gap-2 mb-2">
                            <Clock className="w-3 h-3 text-indigo-500" />
                            <span className="text-[10px] font-bold text-slate-700 uppercase">{tri.name}</span>
                          </div>
                          <div className="flex justify-between items-center">
                            <div>
                              <p className="text-[8px] text-slate-400 uppercase font-bold">Ord</p>
                              <p className="text-sm font-mono font-bold text-indigo-600">{tri.ord.toFixed(1)}h</p>
                            </div>
                            <div className="text-right">
                              <p className="text-[8px] text-slate-400 uppercase font-bold">Exced</p>
                              <p className="text-sm font-mono font-bold text-amber-600">{tri.extra.toFixed(1)}h</p>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {results.all.totalRegularHours > (periods.find(p => p.id === selectedPeriodId)?.extraThreshold || 160) && !trisemanas.some(t => {
                    const p = periods.find(per => per.id === selectedPeriodId);
                    return p && ((t.startDate >= p.startDate && t.startDate <= p.endDate) || (t.endDate >= p.startDate && t.endDate <= p.endDate));
                  }) && (
                    <div className="bg-rose-50 p-3 rounded-2xl border border-rose-100 flex items-center gap-2">
                      <AlertCircle className="w-4 h-4 text-rose-500" />
                      <div className="text-[10px] text-rose-700 font-bold leading-tight">
                        Exceso de {(results.all.totalRegularHours - (periods.find(p => p.id === selectedPeriodId)?.extraThreshold || 160)).toFixed(1)}h<br/>
                        <span className="font-normal opacity-70">Deben ser extras</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
              {/* Legend */}
              <div className="bg-slate-50/50 border-b border-slate-100 p-4 flex flex-wrap gap-x-6 gap-y-2 justify-center items-center">
                <div className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-full bg-amber-500 shadow-sm shadow-amber-200"></div>
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Diurna</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-full bg-indigo-500 shadow-sm shadow-indigo-200"></div>
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Nocturna</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-full bg-rose-500 shadow-sm shadow-rose-200"></div>
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">D-Festiva</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-full bg-purple-500 shadow-sm shadow-purple-200"></div>
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">N-Festiva</span>
                </div>
              </div>

              <div className="overflow-x-auto no-scrollbar relative">
                <div className="md:hidden sticky left-0 right-0 h-1 bg-gradient-to-r from-indigo-500/20 via-transparent to-indigo-500/20 pointer-events-none z-10" />
                <table className="w-full text-left border-collapse min-w-[800px]">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200">
                      <th className="p-4 w-10">
                        <input 
                          type="checkbox" 
                          checked={selectedRecordIds.length > 0 && selectedRecordIds.length === (viewingArchive ? viewingArchive.records : records).length}
                          onChange={toggleSelectAll}
                          className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                        />
                      </th>
                      <th className="p-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Fecha</th>
                      <th className="p-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Horario</th>
                      <th className="p-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest text-center">Adic.</th>
                      <th className="p-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Horas Consulta</th>
                      <th className="p-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Horas AVA/Virtual</th>
                      <th className="p-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Pacientes</th>
                      <th className="p-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Valor Turno (B/N)</th>
                      <th className="p-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest text-center">
                        <button 
                          onClick={toggleAllRecordsStatus}
                          className="px-2 py-1 bg-slate-100 hover:bg-indigo-100 text-slate-500 hover:text-indigo-600 rounded-md transition-colors flex items-center gap-1 mx-auto group"
                          title="Alternar estado definitivo para todos"
                        >
                          <CheckCircle2 className="w-3 h-3" />
                          <span className="text-[8px] font-black uppercase">Todo</span>
                        </button>
                      </th>
                      <th className="p-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest text-right">Acciones</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    <AnimatePresence initial={false}>
                      {(viewingArchive ? viewingArchive.records : records).length === 0 ? (
                        <tr>
                          <td colSpan={6} className="p-10 text-center text-slate-400 italic">No hay turnos registrados aún. Agrega tu primer turno arriba.</td>
                        </tr>
                      ) : (
                        (viewingArchive ? viewingArchive.records : records).map((record) => (
                          <motion.tr 
                            key={record.id}
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, x: -20 }}
                            className={`hover:bg-slate-50/50 transition-all ${
                              record.isAdditionalShift 
                                ? 'bg-yellow-100/70 hover:bg-yellow-200/80 transition-colors' 
                                : selectedRecordIds.includes(record.id) 
                                  ? 'bg-indigo-50/30' 
                                  : ''
                            }`}
                          >
                            <td className="p-4">
                              <input 
                                type="checkbox" 
                                checked={selectedRecordIds.includes(record.id)}
                                onChange={() => toggleSelectRecord(record.id)}
                                className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                              />
                            </td>
                            <td className="p-4 text-sm font-medium text-slate-700">
                              <div className="flex flex-col gap-1">
                                <div className="flex items-center gap-2">
                                  {record.date}
                                  {record.isExtraShift && (
                                    <span className="px-1.5 py-0.5 bg-amber-50 text-amber-600 text-[8px] font-bold uppercase rounded-md border border-amber-200">
                                      Extra
                                    </span>
                                  )}
                                  {(() => {
                                    const dist = results.all.recordDistributions[record.id];
                                    if (dist?.crossedThreshold) {
                                      return (
                                        <span className="px-1.5 py-0.5 bg-rose-100 text-rose-600 text-[8px] font-bold uppercase rounded-md border border-rose-200 animate-pulse">
                                          Límite 132h Alcanzado
                                        </span>
                                      );
                                    }
                                    if (dist?.alreadyOver) {
                                      return (
                                        <span className="px-1.5 py-0.5 bg-slate-100 text-slate-500 text-[8px] font-bold uppercase rounded-md border border-slate-200">
                                          Sobre 132h
                                        </span>
                                      );
                                    }
                                    return null;
                                  })()}
                                </div>
                                {(() => {
                                  const t = record.trisemanaId 
                                    ? trisemanas.find(tri => tri.id === record.trisemanaId)
                                    : trisemanas.find(tri => record.date >= tri.startDate && record.date <= tri.endDate);
                                  return t ? (
                                    <span className="text-[9px] text-amber-600 font-bold uppercase tracking-tighter flex items-center gap-1">
                                      <Clock className="w-2 h-2" /> {t.name}
                                    </span>
                                  ) : (
                                    <span className="text-[9px] text-rose-500 font-bold uppercase tracking-tighter flex items-center gap-1 animate-pulse">
                                      <AlertCircle className="w-2 h-2" /> Sin Trisemana
                                    </span>
                                  );
                                })()}
                              </div>
                            </td>
                            <td className="p-4 text-xs font-mono text-slate-500">
                              {record.startTime} - {record.endTime === '00:00' ? '00:00 (Siguiente día)' : record.endTime}
                            </td>
                            <td className="p-4 text-center">
                              <input 
                                type="checkbox"
                                checked={record.isAdditionalShift || false}
                                onChange={() => toggleAdditionalShift(record.id)}
                                className="w-4 h-4 rounded border-amber-400 text-amber-600 focus:ring-amber-500"
                                title="Marcar como turno adicional"
                              />
                            </td>
                            <td className="p-4 text-xs font-mono font-bold">
                              {(() => {
                                const h = record.hours || { day:0, night:0, holidayDay:0, holidayNight:0, extraDay:0, extraNight:0, extraHolidayDay:0, extraHolidayNight:0 };
                                const dayTotal = (h.day + h.night + h.holidayDay + h.holidayNight) + 
                                              (h.extraDay + h.extraNight + h.extraHolidayDay + h.extraHolidayNight);

                                if (dayTotal === 0) return <span className="text-slate-300 italic font-normal">0.0h</span>;

                                return (
                                  <div className="flex flex-col">
                                    <div className="mb-1">
                                      <span className="text-[10px] font-bold text-slate-400 bg-slate-50 px-1 py-0.5 rounded border border-slate-100">
                                        DÍA: {dayTotal.toFixed(1)}h
                                      </span>
                                    </div>
                                    <div className="flex flex-wrap gap-x-2">
                                      {(h.day + h.extraDay) > 0 && (
                                        <span className="text-amber-600 font-bold" title="Total Diurna">
                                          {(h.day + h.extraDay).toFixed(1)}D
                                          {h.extraDay > 0 && <span className="text-[8px] ml-0.5" title="Incluye Exceso">(+{h.extraDay.toFixed(1)}E)</span>}
                                        </span>
                                      )}
                                      {(h.night + h.extraNight) > 0 && (
                                        <span className="text-indigo-600 font-bold" title="Total Nocturna">
                                          {(h.night + h.extraNight).toFixed(1)}N
                                          {h.extraNight > 0 && <span className="text-[8px] ml-0.5" title="Incluye Exceso">(+{h.extraNight.toFixed(1)}E)</span>}
                                        </span>
                                      )}
                                      {(h.holidayDay + h.extraHolidayDay) > 0 && (
                                        <span className="text-rose-600 font-bold" title="Total Festiva Diurna">
                                          {(h.holidayDay + h.extraHolidayDay).toFixed(1)}FD
                                          {h.extraHolidayDay > 0 && <span className="text-[8px] ml-0.5" title="Incluye Exceso">(+{h.extraHolidayDay.toFixed(1)}E)</span>}
                                        </span>
                                      )}
                                      {(h.holidayNight + h.extraHolidayNight) > 0 && (
                                        <span className="text-purple-600 font-bold" title="Total Festiva Nocturna">
                                          {(h.holidayNight + h.extraHolidayNight).toFixed(1)}FN
                                          {h.extraHolidayNight > 0 && <span className="text-[8px] ml-0.5" title="Incluye Exceso">(+{h.extraHolidayNight.toFixed(1)}E)</span>}
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                );
                              })()}
                            </td>
                            <td className="p-4 text-xs font-mono font-bold">
                              {(() => {
                                const a = record.ava || { day:0, night:0, holidayDay:0, holidayNight:0, extraDay:0, extraNight:0, extraHolidayDay:0, extraHolidayNight:0 };
                                const dayTotalAVA = (a.day + a.night + a.holidayDay + a.holidayNight) + 
                                              (a.extraDay + a.extraNight + a.extraHolidayDay + a.extraHolidayNight);

                                if (dayTotalAVA === 0) return <span className="text-slate-300 italic font-normal">0.0h</span>;

                                return (
                                  <div className="flex flex-col">
                                    <div className="mb-1">
                                      <span className="text-[10px] font-bold text-slate-400 bg-slate-50 px-1 py-0.5 rounded border border-slate-100">
                                        DÍA: {dayTotalAVA.toFixed(1)}h
                                      </span>
                                    </div>
                                    <div className="flex flex-wrap gap-x-2">
                                      {(a.day + a.extraDay) > 0 && (
                                        <span className="text-amber-600 font-bold" title="Total AVA Diurna">
                                          {(a.day + a.extraDay).toFixed(1)}D
                                          {a.extraDay > 0 && <span className="text-[8px] ml-0.5" title="Incluye Exceso">(+{a.extraDay.toFixed(1)}E)</span>}
                                        </span>
                                      )}
                                      {(a.night + a.extraNight) > 0 && (
                                        <span className="text-indigo-600 font-bold" title="Total AVA Nocturna">
                                          {(a.night + a.extraNight).toFixed(1)}N
                                          {a.extraNight > 0 && <span className="text-[8px] ml-0.5" title="Incluye Exceso">(+{a.extraNight.toFixed(1)}E)</span>}
                                        </span>
                                      )}
                                      {(a.holidayDay + a.extraHolidayDay) > 0 && (
                                        <span className="text-rose-600 font-bold" title="Total AVA Festiva Diurna">
                                          {(a.holidayDay + a.extraHolidayDay).toFixed(1)}FD
                                          {a.extraHolidayDay > 0 && <span className="text-[8px] ml-0.5" title="Incluye Exceso">(+{a.extraHolidayDay.toFixed(1)}E)</span>}
                                        </span>
                                      )}
                                      {(a.holidayNight + a.extraHolidayNight) > 0 && (
                                        <span className="text-purple-600 font-bold" title="Total AVA Festiva Nocturna">
                                          {(a.holidayNight + a.extraHolidayNight).toFixed(1)}FN
                                          {a.extraHolidayNight > 0 && <span className="text-[8px] ml-0.5" title="Incluye Exceso">(+{a.extraHolidayNight.toFixed(1)}E)</span>}
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                );
                              })()}
                            </td>
                            <td className="p-4 text-xs font-mono font-bold">
                              {(() => {
                                const p = record.patients || { day:0, night:0, holidayDay:0, holidayNight:0 };
                                const totalP = p.day + p.night + p.holidayDay + p.holidayNight;

                                if (totalP === 0 && record.applyPatients) return <span className="text-slate-300 italic font-normal">0</span>;
                                if (!record.applyPatients) {
                                  const h = record.hours || { day:0, night:0, holidayDay:0, holidayNight:0, extraDay:0, extraNight:0, extraHolidayDay:0, extraHolidayNight:0 };
                                  const hProd = (h.day + h.night + h.holidayDay + h.holidayNight + h.extraDay + h.extraNight + h.extraHolidayDay + h.extraHolidayNight);
                                  return <span className="text-slate-500">{hProd.toFixed(1)}h Prod.</span>;
                                }

                                return (
                                  <div className="flex flex-col">
                                    <div className="mb-1">
                                      <span className="text-[10px] font-bold text-slate-400 bg-slate-50 px-1 py-0.5 rounded border border-slate-100">
                                        TOT: {totalP}
                                      </span>
                                    </div>
                                    <div className="flex flex-wrap gap-x-2">
                                      {p.day > 0 && <span className="text-amber-600 font-bold" title="Diurnos">{p.day}D</span>}
                                      {p.night > 0 && <span className="text-indigo-600 font-bold" title="Nocturnos">{p.night}N</span>}
                                      {p.holidayDay > 0 && <span className="text-rose-600 font-bold" title="Festivos Diurnos">{p.holidayDay}FD</span>}
                                      {p.holidayNight > 0 && <span className="text-purple-600 font-bold" title="Festivos Nocturnos">{p.holidayNight}FN</span>}
                                    </div>
                                  </div>
                                );
                              })()}
                            </td>
                            <td className="p-4 text-xs font-mono">
                              {(() => {
                                const shiftValue = calculateShiftValue(record, results.calculationRates);
                                const grossShift = shiftValue.base + shiftValue.service + shiftValue.extraSurcharge + shiftValue.avaVirtual;
                                const netShift = grossShift * (1 - results.all.effectiveDeductionRate);
                                
                                return (
                                  <div className="flex flex-col">
                                    <span className="font-bold text-slate-700 font-mono tracking-tight text-sm">${Math.round(grossShift).toLocaleString()}</span>
                                    <div className="flex gap-1.5 mt-0.5">
                                      <span className="text-[9px] text-slate-400">Net: ${Math.round(netShift).toLocaleString()}</span>
                                    </div>
                                  </div>
                                );
                              })()}
                            </td>
                            <td className="p-4 text-center">
                              <button 
                                onClick={() => toggleRecordStatus(record.id)}
                                className={`group relative px-3 py-1.5 rounded-xl text-[10px] font-bold transition-all flex items-center gap-1.5 mx-auto ${
                                  record.isDefinitive 
                                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' 
                                    : 'bg-amber-50 text-amber-700 border border-amber-200 hover:bg-emerald-600 hover:text-white hover:border-emerald-600'
                                }`}
                                title={record.isDefinitive ? "Confirmado" : "Click para confirmar como definitivo"}
                              >
                                {record.isDefinitive ? (
                                  <>
                                    <CheckCircle2 className="w-3 h-3" />
                                    <span>Definitivo</span>
                                  </>
                                ) : (
                                  <>
                                    <div className="w-1.5 h-1.5 rounded-full bg-amber-500 group-hover:bg-white animate-pulse" />
                                    <span>Proyección</span>
                                  </>
                                )}
                              </button>
                            </td>
                            <td className="p-4 text-right flex items-center justify-end gap-2">
                              <button 
                                onClick={() => editRecord(record)}
                                className="p-3 text-indigo-500 hover:text-indigo-700 hover:bg-indigo-50 rounded-xl transition-all active:scale-90 border border-transparent hover:border-indigo-100"
                                title="Editar registro"
                              >
                                <Edit className="w-5 h-5" />
                              </button>
                              <button 
                                onClick={() => removeRecord(record.id)}
                                className="p-3 text-rose-500 hover:text-rose-700 hover:bg-rose-50 rounded-xl transition-all active:scale-90 border border-transparent hover:border-rose-100"
                                title="Eliminar registro"
                              >
                                <Trash2 className="w-5 h-5" />
                              </button>
                            </td>
                          </motion.tr>
                        ))
                      )}
                    </AnimatePresence>
                  </tbody>
                  {(viewingArchive ? viewingArchive.records : records).length > 0 && (
                    <tfoot className="bg-slate-50 border-t-2 border-slate-200">
                      <tr>
                        <td colSpan={10} className="p-0">
                          <div className="grid grid-cols-1 md:grid-cols-4 divide-y md:divide-y-0 md:divide-x divide-slate-200">
                            {/* Col 1: Label */}
                            <div className="p-4 bg-slate-100/50 flex flex-col items-center justify-center">
                              <span className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] text-center mb-1">Informe Visual de Bitácora</span>
                              <div className="flex items-center gap-2 px-3 py-1 bg-yellow-500 text-yellow-900 rounded-lg border border-yellow-600 shadow-sm">
                                <span className="text-[9px] font-bold uppercase">Adicionales:</span>
                                <span className="text-sm font-black">{results.all.additionalShiftsCount}</span>
                              </div>
                            </div>
                            
                            {/* Col 2: Consulta Breakdown */}
                            <div className="p-4 bg-white space-y-2">
                              <div className="flex justify-between items-center border-b border-slate-50 pb-1">
                                <span className="text-[9px] font-black text-slate-400 uppercase">Consulta / Libres</span>
                                <span className="text-xs font-mono font-black text-amber-600">{(results.all.totalMonthlyHours).toFixed(1)}h</span>
                              </div>
                              <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                                <div className="flex justify-between text-[9px]">
                                  <span className="text-slate-400">D+E:</span>
                                  <span className="font-mono font-bold text-amber-600">{(results.all.hoursBreakdown.day + results.all.hoursBreakdown.extraDay).toFixed(1)}h</span>
                                </div>
                                <div className="flex justify-between text-[9px]">
                                  <span className="text-slate-400">N+E:</span>
                                  <span className="font-mono font-bold text-indigo-600">{(results.all.hoursBreakdown.night + results.all.hoursBreakdown.extraNight).toFixed(1)}h</span>
                                </div>
                                <div className="flex justify-between text-[9px]">
                                  <span className="text-slate-400">FD+E:</span>
                                  <span className="font-mono font-bold text-rose-600">{(results.all.hoursBreakdown.holidayDay + results.all.hoursBreakdown.extraHolidayDay).toFixed(1)}h</span>
                                </div>
                                <div className="flex justify-between text-[9px]">
                                  <span className="text-slate-400">FN+E:</span>
                                  <span className="font-mono font-bold text-purple-600">{(results.all.hoursBreakdown.holidayNight + results.all.hoursBreakdown.extraHolidayNight).toFixed(1)}h</span>
                                </div>
                              </div>
                            </div>

                            {/* Col 3: AVA Breakdown */}
                            <div className="p-4 bg-indigo-50/20 space-y-2">
                              <div className="flex justify-between items-center border-b border-indigo-100 pb-1">
                                <span className="text-[9px] font-black text-indigo-400 uppercase">AVA / Virtual</span>
                                <span className="text-xs font-mono font-black text-indigo-600">{(results.all.totalMonthlyAVA).toFixed(1)}h</span>
                              </div>
                              <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                                <div className="flex justify-between text-[9px]">
                                  <span className="text-indigo-400">D+E:</span>
                                  <span className="font-mono font-bold text-amber-600">{(results.all.avaBreakdown.day + results.all.avaBreakdown.extraDay).toFixed(1)}h</span>
                                </div>
                                <div className="flex justify-between text-[9px]">
                                  <span className="text-indigo-400">N+E:</span>
                                  <span className="font-mono font-bold text-indigo-600">{(results.all.avaBreakdown.night + results.all.avaBreakdown.extraNight).toFixed(1)}h</span>
                                </div>
                                <div className="flex justify-between text-[9px]">
                                  <span className="text-indigo-400">FD+E:</span>
                                  <span className="font-mono font-bold text-rose-600">{(results.all.avaBreakdown.holidayDay + results.all.avaBreakdown.extraHolidayDay).toFixed(1)}h</span>
                                </div>
                                <div className="flex justify-between text-[9px]">
                                  <span className="text-indigo-400">FN+E:</span>
                                  <span className="font-mono font-bold text-purple-600">{(results.all.avaBreakdown.holidayNight + results.all.avaBreakdown.extraHolidayNight).toFixed(1)}h</span>
                                </div>
                              </div>
                            </div>

                            {/* Col 4: Patients & Values */}
                            <div className="p-4 bg-emerald-50/20 space-y-2">
                              <div className="flex justify-between items-center border-b border-emerald-100 pb-1">
                                <span className="text-[9px] font-black text-emerald-600 uppercase">Productividad</span>
                                <span className="text-xs font-mono font-black text-emerald-700">{results.all.totalMonthlyPatients}p</span>
                              </div>
                              <div className="flex justify-between items-center pt-1">
                                <span className="text-[10px] font-black text-slate-800 uppercase leading-none">Subtotal<br/>Bruto:</span>
                                <span className="text-sm font-mono font-black text-slate-900">{formatCurrency(results.all.gross)}</span>
                              </div>
                            </div>
                          </div>
                        </td>
                        <td colSpan={2} className="bg-slate-100"></td>
                      </tr>
                      {/* Grand Total Footer Row */}
                      <tr className="bg-slate-800 text-white border-t-2 border-slate-900 shadow-inner">
                        <td colSpan={7} className="p-6 text-right text-xl font-black uppercase tracking-widest align-middle">
                          Gran Total Bruto Proyectado:
                        </td>
                        <td colSpan={3} className="p-6 text-right align-middle bg-slate-900">
                          <span className="text-3xl font-mono font-black text-emerald-400">
                            {formatCurrency(results.all.gross)}
                          </span>
                        </td>
                      </tr>
                    </tfoot>
                    )}
                </table>
              </div>
            </div>
          </section>

          {/* Step 3.5: Projections and Totals */}
          <section className="space-y-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-indigo-600 text-white flex items-center justify-center font-bold text-sm">3.5</div>
                <div className="flex items-center gap-3">
                  <h2 className="text-xl font-bold text-slate-800">
                    {viewingArchive ? 'Liquidación Archivada (Acumulado)' : 'Proyecciones y Totales (Acumulado)'}
                  </h2>
                  <span className={`px-3 py-1 ${viewingArchive ? 'bg-amber-100 text-amber-700 border-amber-200' : 'bg-indigo-100 text-indigo-700 border-indigo-200'} text-[10px] font-black uppercase tracking-widest rounded-full border`}>
                    {viewingArchive ? 'Documento Histórico' : 'Incluye Proyecciones'}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2 bg-slate-100 px-3 py-1.5 rounded-xl border border-slate-200">
                <span className="text-[9px] font-black text-slate-400 uppercase">Tarifas Base:</span>
                <span className="text-[10px] font-bold text-slate-600">C: {formatCurrency(rates.base.consultation)} | AVA: {formatCurrency(rates.base.ava)}</span>
              </div>
            </div>
            
            <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm space-y-6">
              <p className="text-sm text-slate-500">Este resumen incluye tanto los registros definitivos como las proyecciones actuales.</p>
              
              <div className="grid grid-cols-1 gap-4">
                <div className="bg-slate-50 p-6 rounded-3xl border border-slate-100 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-slate-600">
                      <Clock className="w-4 h-4" />
                      <span className="text-[10px] font-bold uppercase tracking-widest">Ingresos Brutos</span>
                    </div>
                    <button 
                      onClick={() => setShowIncomeDetails(!showIncomeDetails)}
                      className="p-1 hover:bg-slate-200 rounded-lg transition-colors text-slate-400"
                    >
                      <ChevronDown className={`w-4 h-4 transition-transform ${showIncomeDetails ? 'rotate-180' : ''}`} />
                    </button>
                  </div>
                  <p className="text-3xl font-bold text-slate-800">{formatCurrency(results.all.gross)}</p>
                  <p className="text-[10px] text-slate-400 uppercase font-bold tracking-tighter">
                    {results.all.totalAccumulatedHours}h Totales
                  </p>

                  <AnimatePresence>
                    {showIncomeDetails && (
                      <motion.div 
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="pt-4 space-y-2 border-t border-slate-200 mt-4 overflow-hidden"
                      >
                        <div className="flex justify-between text-[10px] pt-1">
                          <span className="text-slate-500">Base Consulta + Extras:</span>
                          <span className="font-bold text-slate-800">{formatCurrency(results.all.grossBreakdown.consultationBase)}</span>
                        </div>
                        <div className="grid grid-cols-2 gap-2 pl-4 text-[9px] text-slate-400">
                          <div className="flex justify-between"><span>Diu:</span> <span>{results.all.hoursBreakdown.day.toFixed(1)}h</span></div>
                          <div className="flex justify-between"><span>Noc:</span> <span>{results.all.hoursBreakdown.night.toFixed(1)}h</span></div>
                          <div className="flex justify-between"><span>F.D:</span> <span>{results.all.hoursBreakdown.holidayDay.toFixed(1)}h</span></div>
                          <div className="flex justify-between"><span>F.N:</span> <span>{results.all.hoursBreakdown.holidayNight.toFixed(1)}h</span></div>
                          <div className="flex justify-between col-span-2"><span>Extras Totales:</span> <span>{(results.all.hoursBreakdown.extraDay+results.all.hoursBreakdown.extraNight+results.all.hoursBreakdown.extraHolidayDay+results.all.hoursBreakdown.extraHolidayNight).toFixed(1)}h</span></div>
                        </div>

                        <div className="flex justify-between text-[10px] pt-1 mt-1 border-t border-slate-50">
                          <span className="text-violet-600 font-medium">AVA / Virtual:</span>
                          <span className="font-bold text-violet-800">{formatCurrency(results.all.grossBreakdown.ava)}</span>
                        </div>
                        <div className="grid grid-cols-2 gap-2 pl-4 text-[9px] text-violet-400">
                          <div className="flex justify-between"><span>Diu:</span> <span>{results.all.avaBreakdown.day.toFixed(1)}h</span></div>
                          <div className="flex justify-between"><span>Noc:</span> <span>{results.all.avaBreakdown.night.toFixed(1)}h</span></div>
                          <div className="flex justify-between"><span>F.D:</span> <span>{results.all.avaBreakdown.holidayDay.toFixed(1)}h</span></div>
                          <div className="flex justify-between"><span>F.N:</span> <span>{results.all.avaBreakdown.holidayNight.toFixed(1)}h</span></div>
                        </div>

                        <div className="flex justify-between text-[10px] pt-1 mt-1 border-t border-slate-50">
                          <span className="text-emerald-600 font-medium">Servicio / Pacientes:</span>
                          <span className="font-bold text-emerald-800">{formatCurrency(results.all.grossBreakdown.service)}</span>
                        </div>
                        <div className="grid grid-cols-2 gap-2 pl-4 text-[9px] text-emerald-400">
                          <div className="flex justify-between"><span>P.D:</span> <span>{results.all.patientsBreakdown.day}</span></div>
                          <div className="flex justify-between"><span>P.N:</span> <span>{results.all.patientsBreakdown.night}</span></div>
                          <div className="flex justify-between"><span>P.FD:</span> <span>{results.all.patientsBreakdown.holidayDay}</span></div>
                          <div className="flex justify-between"><span>P.FN:</span> <span>{results.all.patientsBreakdown.holidayNight}</span></div>
                        </div>
                        <div className="flex justify-between text-[10px] pt-1 border-t border-slate-100">
                          <span className="text-slate-400">Total Bruto:</span>
                          <span className="font-bold text-slate-900">{formatCurrency(results.all.gross)}</span>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
                
                <div className="bg-indigo-600 p-6 rounded-3xl text-white space-y-2 shadow-xl shadow-indigo-100">
                  <div className="flex items-center gap-2 opacity-80">
                    <Wallet className="w-4 h-4" />
                    <span className="text-[10px] font-bold uppercase tracking-widest">Neto a Recibir (Caja)</span>
                  </div>
                  <p className="text-3xl font-bold">{formatCurrency(results.all.netCash)}</p>
                  <p className="text-[10px] opacity-70 uppercase font-bold tracking-tighter">Proyectado</p>
                </div>

                <div className="bg-rose-50 p-6 rounded-3xl border border-rose-100 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-rose-700">
                      <TrendingDown className="w-4 h-4" />
                      <span className="text-[10px] font-bold uppercase tracking-widest">Deducciones</span>
                    </div>
                    <button 
                      onClick={() => setShowDeductionDetails(!showDeductionDetails)}
                      className="p-1 hover:bg-rose-100 rounded-lg transition-colors text-rose-600"
                    >
                      <ChevronDown className={`w-4 h-4 transition-transform ${showDeductionDetails ? 'rotate-180' : ''}`} />
                    </button>
                  </div>
                  <p className="text-3xl font-bold text-rose-800">{formatCurrency(results.all.totalDeductions)}</p>
                  <p className="text-[10px] text-rose-400 uppercase font-bold tracking-tighter">Legales + Otras</p>

                  <AnimatePresence>
                    {showDeductionDetails && (
                      <motion.div 
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="pt-4 space-y-4 border-t border-rose-100 mt-4 overflow-hidden"
                      >
                        <div className="space-y-2">
                          <p className="text-[9px] font-black text-rose-500 uppercase tracking-widest">Deducciones de Ley</p>
                          <div className="flex justify-between text-[10px]">
                            <span className="text-slate-500">Salud (4%):</span>
                            <span className="font-bold text-rose-700">{formatCurrency(results.all.taxBreakdown.health)}</span>
                          </div>
                          <div className="flex justify-between text-[10px]">
                            <span className="text-slate-500">Pensión (4%):</span>
                            <span className="font-bold text-rose-700">{formatCurrency(results.all.taxBreakdown.pension)}</span>
                          </div>
                          {results.all.taxBreakdown.fsp > 0 && (
                            <div className="flex justify-between text-[10px]">
                              <span className="text-slate-500">F. Solidaridad Pens.:</span>
                              <span className="font-bold text-rose-700">{formatCurrency(results.all.taxBreakdown.fsp)}</span>
                            </div>
                          )}
                          <div className="flex justify-between items-center text-[10px]">
                            <div className="flex items-center gap-2">
                              <span className="text-slate-500 font-bold">Retención en la Fuente:</span>
                              <button 
                                onClick={() => {
                                  // Open config at the Retefuente section
                                  handleEnableConfigEdit();
                                  // We can't easily scroll to it but we can highlight it or something
                                  // For now just open it
                                  showToast("Ajusta la Retención en la Fuente en la Configuración.", 'info');
                                }}
                                className="p-1 hover:bg-rose-100 rounded text-rose-500 transition-colors"
                                title="Modificar Retefuente"
                              >
                                <Edit3 className="w-3 h-3" />
                              </button>
                            </div>
                            <span className="font-bold text-rose-800">{formatCurrency(results.all.taxBreakdown.retefuente)}</span>
                          </div>
                          {results.all.taxBreakdown.additionalDeductions > 0 && (
                            <div className="flex justify-between text-[10px] pt-1 border-t border-rose-100/50">
                              <span className="text-slate-500">Otras Deducciones:</span>
                              <span className="font-bold text-rose-700">{formatCurrency(results.all.taxBreakdown.additionalDeductions)}</span>
                            </div>
                          )}
                        </div>

                        <div className="space-y-2 bg-white/50 p-3 rounded-2xl border border-rose-100/50">
                          <p className="text-[9px] font-black text-indigo-500 uppercase tracking-widest">Detalle Rete-Fuente</p>
                          <div className="flex justify-between text-[10px]">
                            <span className="text-slate-500">Ingreso Neto Gravable:</span>
                            <span className="font-bold text-slate-700">{formatCurrency(results.all.retefuenteBreakdown.netIncome)}</span>
                          </div>
                          {results.all.retefuenteBreakdown.dedPrepagada > 0 && (
                            <div className="flex justify-between text-[10px]">
                              <span className="text-emerald-600">Medicina Prepagada:</span>
                              <span className="font-bold text-emerald-700">-{formatCurrency(results.all.retefuenteBreakdown.dedPrepagada)}</span>
                            </div>
                          )}
                          <div className="flex justify-between text-[10px]">
                            <span className="text-slate-500">Exento 25% Ley:</span>
                            <span className="font-bold text-slate-700">-{formatCurrency(results.all.retefuenteBreakdown.exempt25)}</span>
                          </div>
                          <div className="flex justify-between text-[10px] pt-1 border-t border-indigo-100/50">
                            <span className="text-indigo-600 font-bold uppercase text-[8px]">Base en UVT:</span>
                            <span className="font-bold text-indigo-700">{results.all.retefuenteBreakdown.baseUVT.toFixed(2)} UVT</span>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                <div className="bg-emerald-50 p-6 rounded-3xl border border-emerald-100 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-emerald-700">
                      <TrendingUp className="w-4 h-4" />
                      <span className="text-[10px] font-bold uppercase tracking-widest">Ganancia Total Real</span>
                    </div>
                    <button 
                      onClick={() => setShowProjectionDetails(!showProjectionDetails)}
                      className="p-1 hover:bg-emerald-100 rounded-lg transition-colors text-emerald-600"
                    >
                      <ChevronDown className={`w-4 h-4 transition-transform ${showProjectionDetails ? 'rotate-180' : ''}`} />
                    </button>
                  </div>
                  <p className="text-3xl font-bold text-emerald-800">{formatCurrency(results.all.net)}</p>
                  <p className="text-[10px] text-emerald-400 uppercase font-bold tracking-tighter italic">
                    Incluye Prestaciones
                  </p>

                  <AnimatePresence>
                    {showProjectionDetails && (
                      <motion.div 
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="pt-4 space-y-2 border-t border-emerald-100 mt-4 overflow-hidden"
                      >
                        <div className="flex justify-between text-[10px]">
                          <span className="text-emerald-600 font-medium">Salario Facturado (Bruto):</span>
                          <span className="font-bold text-emerald-800">{formatCurrency(results.all.gross)}</span>
                        </div>
                        <div className="flex justify-between text-[10px]">
                          <span className="text-emerald-600 font-medium">Prima Proporcional:</span>
                          <span className="font-bold text-emerald-800">{formatCurrency(results.all.primaProporcional)}</span>
                        </div>
                        <div className="flex justify-between text-[10px]">
                          <span className="text-emerald-600 font-medium">Cesantías Proporcionales:</span>
                          <span className="font-bold text-emerald-800">{formatCurrency(results.all.cesantiasProporcional)}</span>
                        </div>
                        <div className="flex justify-between text-[10px]">
                          <span className="text-emerald-600 font-medium">Intereses Cesantías:</span>
                          <span className="font-bold text-emerald-800">{formatCurrency(results.all.interesesCesantias)}</span>
                        </div>
                        <div className="flex justify-between text-[10px]">
                          <span className="text-emerald-600 font-medium">Vacaciones Proporcionales:</span>
                          <span className="font-bold text-emerald-800">{formatCurrency(results.all.vacacionesProporcional)}</span>
                        </div>
                        <div className="flex justify-between text-[10px] pt-1 border-t border-emerald-100">
                          <span className="text-rose-600 font-medium">Deducciones Totales:</span>
                          <span className="font-bold text-rose-700">-{formatCurrency(results.all.totalDeductions)}</span>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>
            </div>
          </section>

          {/* Step 4: Final Extract (Liquidación Técnica) */}
          <section className="space-y-6" id="final-extract-section">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-slate-900 text-white flex items-center justify-center font-black text-lg shadow-lg">4</div>
                <div>
                  <h2 className="text-2xl font-black text-slate-800 tracking-tight">Extracto Final de Pago</h2>
                  <p className="text-xs text-slate-500 font-bold uppercase tracking-widest">Liquidación Técnica Oficial</p>
                </div>
              </div>
              
              {!allRecordsAreDefinitive ? (
                <div className="flex items-center gap-3 px-4 py-2 bg-amber-50 border border-amber-200 rounded-2xl animate-pulse">
                  <AlertCircle className="w-5 h-5 text-amber-600" />
                  <span className="text-[10px] font-black text-amber-700 uppercase">Sincroniza todos los turnos para generar el extracto</span>
                  <button 
                    onClick={toggleAllRecordsStatus}
                    className="ml-2 px-3 py-1 bg-amber-600 text-white text-[10px] font-bold rounded-lg hover:bg-amber-700 transition-colors"
                  >
                    Marcar Todo
                  </button>
                </div>
              ) : (
                <div className={`flex items-center gap-2 px-4 py-2 rounded-2xl border ${extractVerified.isValid ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-rose-50 border-rose-200 text-rose-700'}`}>
                  {extractVerified.isValid ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
                  <span className="text-[10px] font-black uppercase">
                    {extractVerified.isValid ? 'Cálculos Verificados (100% Match)' : 'Discrepancia en Cálculos Detectada'}
                  </span>
                </div>
              )}
            </div>
            
            {allRecordsAreDefinitive ? (
              <motion.div 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className={`bg-white rounded-[40px] border-2 shadow-2xl overflow-hidden ${extractVerified.isValid ? 'border-slate-800' : 'border-rose-500'}`}
              >
                {/* Header Section */}
                <div className="bg-slate-900 p-8 text-white flex flex-col md:flex-row justify-between items-start md:items-center gap-8">
                  <div className="space-y-4">
                    <div className="flex items-center gap-4">
                      <div className="w-16 h-16 bg-white/10 rounded-2xl flex items-center justify-center backdrop-blur-sm">
                        <FileText className="w-8 h-8 text-indigo-400" />
                      </div>
                      <div>
                        <h3 className="text-3xl font-black tracking-tight leading-none">
                          {periods.find(p => p.id === selectedPeriodId)?.name || 'Extracto de Pago'}
                        </h3>
                        <p className="text-indigo-300 font-bold text-xs uppercase tracking-[0.2em] mt-1">Liquidación Consolidada</p>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-4 pt-2">
                      <div className="bg-white/5 border border-white/10 px-4 py-2 rounded-xl">
                        <span className="block text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1">Horas Registradas</span>
                        <span className="text-lg font-mono font-bold">{results.all.totalAccumulatedHours.toFixed(1)}h</span>
                      </div>
                      <div className="bg-white/5 border border-white/10 px-4 py-2 rounded-xl">
                        <span className="block text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1">Pacientes Atendidos</span>
                        <span className="text-lg font-mono font-bold">{results.all.totalMonthlyPatients}</span>
                      </div>
                      <div className="bg-white/5 border border-white/10 px-4 py-2 rounded-xl">
                        <span className="block text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1">Tarifa Hora Base</span>
                        <span className="text-lg font-mono font-bold">{formatCurrency(rates.base.consultation)}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col gap-3 w-full md:w-auto">
                    <button 
                      onClick={() => {
                        if (results.definitive.gross === 0 && results.all.gross > 0) {
                          showToast("Este extracto solo incluye turnos marcados como DEFINITIVOS. Usa 'PDF Borrador' para proyectar todo.", "info");
                        }
                        exportToPDF(false);
                      }}
                      className="w-full bg-indigo-500 hover:bg-indigo-400 text-white font-black py-4 px-8 rounded-2xl transition-all shadow-lg flex items-center justify-center gap-3 text-sm group"
                    >
                      <FileDown className="w-5 h-5 group-hover:-translate-y-1 transition-transform" />
                      GENERAR PDF DEFINITIVO
                    </button>
                    <div className="flex gap-2">
                      <button 
                        onClick={() => exportToExcel()}
                        className="flex-1 bg-white/10 hover:bg-white/20 text-white font-bold py-3 px-4 rounded-xl transition-all flex items-center justify-center gap-2 text-xs"
                      >
                        <FileDown className="w-4 h-4" />
                        Excel
                      </button>
                      <button 
                        onClick={() => exportToPDF(true)}
                        className="flex-1 bg-slate-700 hover:bg-slate-600 text-white font-bold py-3 px-4 rounded-xl transition-all flex items-center justify-center gap-2 text-xs border border-slate-600"
                      >
                        <FileDown className="w-4 h-4" />
                        PDF Borrador
                      </button>
                      {activePeriod && selectedPeriodId === activePeriod.id && (
                        <button 
                          onClick={() => {
                            if (window.confirm("¿Estás seguro de cerrar este periodo? Se guardarán todos los valores actuales en el historial y se dejará de sincronizar.")) {
                              archiveActivePeriod();
                            }
                          }}
                          className="flex-1 bg-indigo-600 text-white font-bold py-3 px-4 rounded-xl hover:bg-indigo-700 transition-all flex items-center justify-center gap-2 text-xs shadow-lg"
                        >
                          <Archive className="w-4 h-4" />
                          Archivar
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {/* Extract Body (Mirrors Section 3.5) */}
                <div className="p-8 lg:p-12 space-y-10">
                  {/* Grid de Discriminación Detallada (Requested by User) */}
                  <div className="space-y-4">
                     <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.3em] flex items-center gap-2">
                        <div className="w-6 h-0.5 bg-indigo-500" />
                        Matriz de Auditoría de Horas y Productividad (Vista Lineal)
                     </h4>
                     <div className="overflow-x-auto pb-6">
                        <div className="min-w-[1000px] border-2 border-slate-800 rounded-3xl overflow-hidden bg-white shadow-xl">
                           <table className="w-full text-[10px] border-collapse">
                              <thead>
                                 <tr className="bg-slate-900 text-white font-black uppercase text-center text-[9px] divide-x divide-slate-700">
                                    <th className="p-3">Categoría</th>
                                    <th className="p-2 bg-amber-500/10">DIU</th>
                                    <th className="p-2 bg-indigo-500/10">NOC</th>
                                    <th className="p-2 bg-rose-500/10 text-rose-300">FD</th>
                                    <th className="p-2 bg-purple-500/10 text-purple-300">FN</th>
                                    <th className="p-2 bg-rose-700 text-white">ED</th>
                                    <th className="p-2 bg-rose-700 text-white">EN</th>
                                    <th className="p-2 bg-rose-700 text-white">EFD</th>
                                    <th className="p-2 bg-rose-700 text-white">EFN</th>
                                    <th className="p-3 bg-slate-800 whitespace-nowrap">Total H</th>
                                 </tr>
                              </thead>
                              <tbody className="font-mono divide-y divide-slate-200">
                                 {/* Consulta Row */}
                                 <tr className="text-center group hover:bg-slate-50 divide-x divide-slate-100">
                                    <td className="p-3 font-black text-left bg-slate-50 group-hover:bg-indigo-50 transition-colors uppercase text-[9px]">CONSULTA / LIBRES</td>
                                    <td className="p-2 text-amber-700 font-bold">{(results.all.hoursBreakdown.day).toFixed(1)}h</td>
                                    <td className="p-2 text-indigo-700 font-bold">{(results.all.hoursBreakdown.night).toFixed(1)}h</td>
                                    <td className="p-2 text-rose-700 font-bold">{(results.all.hoursBreakdown.holidayDay).toFixed(1)}h</td>
                                    <td className="p-2 text-purple-700 font-bold">{(results.all.hoursBreakdown.holidayNight).toFixed(1)}h</td>
                                    <td className="p-2 text-rose-600 font-bold">{(results.all.hoursBreakdown.extraDay).toFixed(1)}h</td>
                                    <td className="p-2 text-rose-600 font-bold">{(results.all.hoursBreakdown.extraNight).toFixed(1)}h</td>
                                    <td className="p-2 text-rose-600 font-bold">{(results.all.hoursBreakdown.extraHolidayDay).toFixed(1)}h</td>
                                    <td className="p-2 text-rose-600 font-bold">{(results.all.hoursBreakdown.extraHolidayNight).toFixed(1)}h</td>
                                    <td className="p-3 bg-slate-100 font-black text-slate-900 border-l border-slate-200">
                                       {(results.all.totalMonthlyHours).toFixed(1)}h
                                    </td>
                                 </tr>
                                 {/* AVA Row */}
                                 <tr className="text-center group hover:bg-indigo-50/50 divide-x divide-slate-100">
                                    <td className="p-3 font-black text-left bg-indigo-50/30 group-hover:bg-indigo-50 uppercase text-[9px]">AVA / VIRTUAL</td>
                                    <td className="p-2 text-amber-700 font-bold">{(results.all.avaBreakdown.day).toFixed(1)}h</td>
                                    <td className="p-2 text-indigo-700 font-bold">{(results.all.avaBreakdown.night).toFixed(1)}h</td>
                                    <td className="p-2 text-rose-700 font-bold">{(results.all.avaBreakdown.holidayDay).toFixed(1)}h</td>
                                    <td className="p-2 text-purple-700 font-bold">{(results.all.avaBreakdown.holidayNight).toFixed(1)}h</td>
                                    <td className="p-2 text-rose-600 font-bold">{(results.all.avaBreakdown.extraDay).toFixed(1)}h</td>
                                    <td className="p-2 text-rose-600 font-bold">{(results.all.avaBreakdown.extraNight).toFixed(1)}h</td>
                                    <td className="p-2 text-rose-600 font-bold">{(results.all.avaBreakdown.extraHolidayDay).toFixed(1)}h</td>
                                    <td className="p-2 text-rose-600 font-bold">{(results.all.avaBreakdown.extraHolidayNight).toFixed(1)}h</td>
                                    <td className="p-3 bg-indigo-100/50 font-black text-indigo-900 border-l border-slate-200">
                                       {(results.all.totalMonthlyAVA).toFixed(1)}h
                                    </td>
                                 </tr>
                                 {/* Pacientes Row */}
                                 <tr className="text-center group hover:bg-emerald-50/50 divide-x divide-slate-100">
                                    <td className="p-3 font-black text-left bg-emerald-50/30 group-hover:bg-emerald-50 text-emerald-800 uppercase text-[9px]">PACIENTES (PROD)</td>
                                    <td className="p-2 text-emerald-600 font-black">{results.all.patientsBreakdown.day}p</td>
                                    <td className="p-2 text-emerald-600 font-black">{results.all.patientsBreakdown.night}p</td>
                                    <td className="p-2 text-emerald-600 font-black">{results.all.patientsBreakdown.holidayDay}p</td>
                                    <td className="p-2 text-emerald-600 font-black">{results.all.patientsBreakdown.holidayNight}p</td>
                                    <td colSpan={4} className="p-2 text-emerald-400 font-bold italic">-</td>
                                    <td className="p-3 bg-emerald-100/50 font-black text-emerald-900 border-l border-slate-200">
                                       {results.all.totalMonthlyPatients}p
                                    </td>
                                 </tr>
                              </tbody>
                              <tfoot className="bg-slate-900 text-white font-black text-center text-[9px] divide-x divide-slate-800">
                                 <tr>
                                    <td className="p-3 text-left">TOTAL CONSOLIDADO</td>
                                    <td className="p-2">{(results.all.hoursBreakdown.day + results.all.avaBreakdown.day).toFixed(1)}h</td>
                                    <td className="p-2">{(results.all.hoursBreakdown.night + results.all.avaBreakdown.night).toFixed(1)}h</td>
                                    <td className="p-2">{(results.all.hoursBreakdown.holidayDay + results.all.avaBreakdown.holidayDay).toFixed(1)}h</td>
                                    <td className="p-2">{(results.all.hoursBreakdown.holidayNight + results.all.avaBreakdown.holidayNight).toFixed(1)}h</td>
                                    <td className="p-2 text-rose-400">{(results.all.hoursBreakdown.extraDay + results.all.avaBreakdown.extraDay).toFixed(1)}h</td>
                                    <td className="p-2 text-rose-400">{(results.all.hoursBreakdown.extraNight + results.all.avaBreakdown.extraNight).toFixed(1)}h</td>
                                    <td className="p-2 text-rose-400">{(results.all.hoursBreakdown.extraHolidayDay + results.all.avaBreakdown.extraHolidayDay).toFixed(1)}h</td>
                                    <td className="p-2 text-rose-400">{(results.all.hoursBreakdown.extraHolidayNight + results.all.avaBreakdown.extraHolidayNight).toFixed(1)}h</td>
                                    <td className="p-3 bg-slate-950 text-emerald-400">{(results.all.totalMonthlyHours + results.all.totalMonthlyAVA).toFixed(1)}h</td>
                                 </tr>
                              </tfoot>
                           </table>
                        </div>
                     </div>
                  </div>

                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                      {/* Column 1: Income Breakdown */}
                      <div className="space-y-4">
                        <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.3em] flex items-center gap-2">
                          <div className="w-6 h-0.5 bg-emerald-500" />
                          Ingresos Productivos
                        </h4>
                        <div className="border border-slate-200 rounded-[32px] overflow-hidden bg-white shadow-sm font-mono">
                          <div className="bg-slate-50 p-4 border-b border-slate-200 flex justify-between items-center">
                             <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest leading-none">Base + Variables</span>
                             <span className="text-xs font-black text-slate-800">{formatCurrency(results.all.gross)}</span>
                          </div>
                          <div className="grid grid-cols-1 divide-y divide-slate-100">
                             <div className="p-4 flex justify-between items-center hover:bg-slate-50/50 transition-colors">
                                <span className="text-[10px] font-black text-slate-400 uppercase">Consultas</span>
                                <span className="text-xs font-bold text-slate-700">{formatCurrency(results.all.grossBreakdown.consultationBase)}</span>
                             </div>
                             <div className="p-4 flex justify-between items-center hover:bg-slate-50/50 transition-colors">
                                <span className="text-[10px] font-black text-indigo-500 uppercase">AVA / Virtual</span>
                                <span className="text-xs font-bold text-indigo-700">{formatCurrency(results.all.grossBreakdown.ava)}</span>
                             </div>
                             <div className="p-4 flex justify-between items-center hover:bg-emerald-50 transition-colors">
                                <span className="text-[10px] font-black text-emerald-600 uppercase">Productividad</span>
                                <span className="text-xs font-bold text-emerald-700">{formatCurrency(results.all.grossBreakdown.service)}</span>
                             </div>
                          </div>
                        </div>
                      </div>

                      {/* Column 2: Deductions */}
                      <div className="space-y-4">
                         <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.3em] flex items-center gap-2">
                          <div className="w-6 h-0.5 bg-rose-500" />
                          Retenciones Legales
                        </h4>
                        <div className="border border-slate-200 rounded-[32px] overflow-hidden bg-white shadow-sm font-mono">
                          <div className="bg-rose-50 p-4 border-b border-rose-100 flex justify-between items-center">
                             <span className="text-[10px] font-black text-rose-500 uppercase tracking-widest leading-none">Total Descuentos</span>
                             <span className="text-xs font-black text-rose-700">-{formatCurrency(results.all.totalDeductions)}</span>
                          </div>
                          <div className="grid grid-cols-1 divide-y divide-slate-100">
                             <div className="p-4 flex justify-between items-center hover:bg-rose-50/30 transition-colors">
                                <span className="text-[10px] font-black text-rose-500 uppercase">Salud / Pensión</span>
                                <span className="text-xs font-bold text-rose-700">-{formatCurrency(results.all.taxBreakdown.health + results.all.taxBreakdown.pension)}</span>
                             </div>
                             <div className="p-4 flex justify-between items-center hover:bg-rose-50/30 transition-colors">
                                <span className="text-[10px] font-black text-rose-500 uppercase">Otras Deduc.</span>
                                <span className="text-xs font-bold text-rose-700">-{formatCurrency(results.all.additionalDeductions)}</span>
                             </div>
                             {results.all.taxBreakdown.fsp > 0 && (
                               <div className="p-4 flex justify-between items-center hover:bg-rose-50/30 transition-colors">
                                  <span className="text-[10px] font-black text-rose-500 uppercase">Auditoria FSP</span>
                                  <span className="text-xs font-bold text-rose-700">-{formatCurrency(results.all.taxBreakdown.fsp)}</span>
                               </div>
                             )}
                          </div>
                        </div>
                      </div>

                      {/* Column 3: Social Benefits and Net */}
                      <div className="space-y-4">
                         <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.3em] flex items-center gap-2">
                          <div className="w-6 h-0.5 bg-indigo-500" />
                          Liquidación Neta
                        </h4>
                        <div className="border-2 border-indigo-600 rounded-[32px] overflow-hidden bg-slate-900 shadow-xl font-mono relative">
                          <div className="absolute top-0 right-0 p-2 opacity-20">
                             <ShieldCheck className="w-12 h-12 text-white" />
                          </div>
                          <div className="p-5 border-b border-slate-800 bg-slate-950/50">
                             <span className="block text-[8px] font-black text-indigo-400 uppercase tracking-[0.3em] mb-1">Ahorro Prestacional</span>
                             <span className="text-lg font-black text-indigo-300">
                                {formatCurrency(results.all.primaProporcional + results.all.cesantiasProporcional + results.all.vacacionesProporcional)}
                             </span>
                          </div>
                          <div className="p-6 text-center space-y-1 relative z-10">
                             <span className="text-[9px] font-black text-indigo-400 uppercase tracking-[0.5em]">TOTAL NETO CAJA</span>
                             <p className="text-3xl font-black text-white tabular-nums tracking-tighter">
                               {formatCurrency(results.all.netCash)}
                             </p>
                             <div className="inline-flex items-center gap-2 mt-2 px-3 py-1 bg-emerald-500/20 text-emerald-400 rounded-full text-[9px] font-black border border-emerald-500/30">
                                <Check className="w-3 h-3" />
                                CONCILIADO
                             </div>
                          </div>
                        </div>
                      </div>
                    </div>

                  {/* Legal Footer */}
                  <div className="pt-10 border-t border-slate-100 flex flex-col md:flex-row items-center justify-between gap-6">
                    <p className="text-[9px] text-slate-400 font-medium max-w-lg leading-relaxed">
                      Este documento certifica la liquidación técnica de honorarios. Los valores coinciden exactamente con la bitácora de turnos del sistema y la sección de resultados consolidados (3.5). Nota: Las deducciones de ley han sido validadas según la configuración vigente.
                    </p>
                    <div className="flex items-center gap-4 grayscale opacity-40 hover:grayscale-0 hover:opacity-100 transition-all">
                       <Calculator className="w-6 h-6 text-slate-900" />
                       <div className="h-8 w-px bg-slate-200" />
                       <ShieldCheck className="w-6 h-6 text-slate-900" />
                    </div>
                  </div>
                </div>
              </motion.div>
            ) : (
              <div className="bg-slate-50 border-2 border-dashed border-slate-200 rounded-[40px] py-32 flex flex-col items-center justify-center text-center space-y-6 shadow-inner">
                <div className="w-24 h-24 bg-white rounded-[32px] shadow-xl border border-slate-100 flex items-center justify-center relative group">
                   <Lock className="w-10 h-10 text-slate-200 group-hover:text-indigo-400 transition-colors" />
                   <div className="absolute inset-0 bg-indigo-50 animate-pulse rounded-[32px] opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
                <div className="max-w-md space-y-2 px-8">
                  <h3 className="text-2xl font-black text-slate-800 tracking-tight">Extracto No Disponible</h3>
                  <p className="text-sm text-slate-500 leading-relaxed font-medium italic">
                    "El extracto técnico garantiza que los cálculos son definitivos e inmutables. Para generarlo, primero debes validar todos los registros en tu bitácora de turnos."
                  </p>
                </div>
                <button 
                  onClick={toggleAllRecordsStatus}
                  className="bg-indigo-600 hover:bg-slate-900 text-white px-10 py-5 rounded-[24px] font-black text-sm transition-all shadow-2xl shadow-indigo-200 flex items-center gap-3 transform hover:scale-105 active:scale-95"
                >
                  <CheckCircle2 className="w-5 h-5" />
                  CONFIRMAR TODO Y DESBLOQUEAR
                </button>
              </div>
            )}
          </section>

          {/* Section 5: Accumulated Potals and Benefits */}
          <section className="space-y-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-indigo-600 text-white flex items-center justify-center font-bold text-sm">5</div>
                <h2 className="text-xl font-bold text-slate-800 tracking-tight">Prestaciones Sociales y Acumulados</h2>
              </div>
              <div className="flex items-center gap-2">
                <button 
                  onClick={openHistoricalModal}
                  className="px-4 py-2 bg-emerald-50 border border-emerald-200 text-emerald-600 text-xs font-black uppercase tracking-widest rounded-xl hover:bg-emerald-100 transition-all flex items-center gap-2"
                >
                  <PlusCircle className="w-3.5 h-3.5" />
                  Registro Histórico Manual
                </button>
                <button 
                  onClick={() => setShowAccumulatedDetails(!showAccumulatedDetails)}
                  className="px-4 py-2 bg-white border border-indigo-200 text-indigo-600 text-xs font-bold rounded-xl hover:bg-indigo-50 transition-all flex items-center gap-2"
                >
                  {showAccumulatedDetails ? 'Ocultar Desglose' : 'Ver Matriz de Periodos'}
                  <ChevronDown className={`w-4 h-4 transition-transform ${showAccumulatedDetails ? 'rotate-180' : ''}`} />
                </button>
              </div>
            </div>

            <div className="bg-white p-8 rounded-3xl border border-slate-200 shadow-sm space-y-8">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                {(() => {
                  const accumulated = periods.reduce((acc, p) => {
                    const isCurrent = p.id === selectedPeriodId;
                    const pGross = isCurrent ? results.all.gross : (p.totalGross || 0);
                    const pTotalGross = isCurrent ? results.all.totalPatrimonial : (p.totalGrossWithBenefits || 0);
                    const pDeductions = isCurrent ? results.all.totalDeductions : (p.totalDeductions || 0);
                    const pNet = isCurrent ? results.all.net : (p.net || 0);
                    const pPrima = isCurrent ? results.all.primaProporcional : (p.primaProporcional || 0);
                    const pCesantias = isCurrent ? results.all.cesantiasProporcional : (p.cesantiasProporcional || 0);
                    const pIntereses = isCurrent ? results.all.interesesCesantias : (p.interesesCesantias || 0);
                    const pVacaciones = isCurrent ? results.all.vacacionesProporcional : (p.vacacionesProporcional || 0);

                    return {
                      gross: acc.gross + pGross,
                      totalGross: acc.totalGross + pTotalGross,
                      deductions: acc.deductions + pDeductions,
                      net: acc.net + pNet,
                      prima: acc.prima + pPrima,
                      cesantias: acc.cesantias + pCesantias,
                      intereses: acc.intereses + pIntereses,
                      vacaciones: acc.vacaciones + pVacaciones
                    };
                  }, { gross: 0, totalGross: 0, deductions: 0, net: 0, prima: 0, cesantias: 0, intereses: 0, vacaciones: 0 });

                  return (
                    <div className="space-y-6 w-full col-span-full">
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                        {/* Balance General Card */}
                        <div className="border-2 border-slate-200 rounded-[32px] overflow-hidden bg-white shadow-sm transition-all hover:shadow-md">
                          <div className="p-4 bg-slate-50 border-b border-slate-200 flex items-center gap-2">
                             <div className="w-1 h-4 bg-indigo-600 rounded-full" />
                             <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest leading-none">Balance de Patrimonio Acumulado</span>
                          </div>
                          <div className="grid grid-cols-2 divide-x divide-y divide-slate-100 font-mono">
                             <div className="p-5 flex flex-col justify-center gap-1 group hover:bg-slate-50 transition-colors">
                                <span className="text-[9px] font-black text-slate-400 uppercase tracking-tighter leading-none mb-1">Ingreso Bruto</span>
                                <span className="text-base font-black text-slate-800 leading-none">{formatCurrency(accumulated.gross)}</span>
                             </div>
                             <div className="p-5 flex flex-col justify-center gap-1 group hover:bg-emerald-50/30 transition-colors">
                                <span className="text-[9px] font-black text-emerald-500 uppercase tracking-tighter leading-none mb-1">Patrimonio (+Prest)</span>
                                <span className="text-base font-black text-emerald-700 leading-none">{formatCurrency(accumulated.totalGross)}</span>
                             </div>
                             <div className="p-5 flex flex-col justify-center gap-1 group hover:bg-rose-50/30 transition-colors">
                                <span className="text-[9px] font-black text-rose-500 uppercase tracking-tighter leading-none mb-1">Retenciones</span>
                                <span className="text-base font-black text-rose-700 leading-none">-{formatCurrency(accumulated.deductions)}</span>
                             </div>
                             <div className="p-5 flex flex-col justify-center bg-indigo-600 text-white shadow-[inset_0_2px_10px_rgba(0,0,0,0.1)]">
                                <span className="text-[9px] font-black uppercase opacity-70 tracking-tighter leading-none mb-1">Saldo Neto Real</span>
                                <span className="text-lg font-black leading-none drop-shadow-sm">{formatCurrency(accumulated.net)}</span>
                             </div>
                          </div>
                        </div>

                        {/* Prestaciones Card */}
                        <div className="border-2 border-slate-200 rounded-[32px] overflow-hidden bg-white shadow-sm transition-all hover:shadow-md">
                          <div className="p-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                             <div className="flex items-center gap-2">
                                <div className="w-1 h-4 bg-emerald-600 rounded-full" />
                                <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest leading-none">Provisiones Sociales Técnicas</span>
                             </div>
                             <span className="text-[8px] bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-black uppercase tracking-tighter">Cierre de Vigencia</span>
                          </div>
                          <div className="grid grid-cols-2 divide-x divide-y divide-slate-100 font-mono">
                             <div className="p-5 flex flex-col justify-center gap-1 hover:bg-emerald-50/30 transition-colors">
                                <div className="flex justify-between items-start mb-1">
                                   <span className="text-[9px] font-black text-emerald-600 uppercase tracking-tighter">Prima</span>
                                   <span className="text-[7px] text-slate-400 font-bold">JUN / DIC</span>
                                </div>
                                <span className="text-base font-black text-emerald-700 leading-none">{formatCurrency(accumulated.prima)}</span>
                             </div>
                             <div className="p-5 flex flex-col justify-center gap-1 hover:bg-amber-50/30 transition-colors">
                                <div className="flex justify-between items-start mb-1">
                                   <span className="text-[9px] font-black text-amber-600 uppercase tracking-tighter">Cesantías</span>
                                   <span className="text-[7px] text-slate-400 font-bold text-right uppercase">Ley 50</span>
                                </div>
                                <span className="text-base font-black text-amber-700 leading-none">{formatCurrency(accumulated.cesantias)}</span>
                             </div>
                             <div className="p-5 flex flex-col justify-center gap-1 hover:bg-violet-50/30 transition-colors">
                                <div className="flex justify-between items-start mb-1">
                                   <span className="text-[9px] font-black text-violet-600 uppercase tracking-tighter">Vacaciones</span>
                                   <span className="text-[7px] text-slate-400 font-bold">15 DÍAS/AÑO</span>
                                </div>
                                <span className="text-base font-black text-violet-700 leading-none">{formatCurrency(accumulated.vacaciones)}</span>
                             </div>
                             <div className="p-5 flex flex-col justify-center gap-1 hover:bg-rose-50/30 transition-colors">
                                <div className="flex justify-between items-start mb-1">
                                   <span className="text-[9px] font-black text-rose-600 uppercase tracking-tighter">Intereses</span>
                                   <span className="text-[7px] text-slate-400 font-bold italic">12% ANUAL</span>
                                </div>
                                <span className="text-base font-black text-rose-700 leading-none">{formatCurrency(accumulated.intereses)}</span>
                             </div>
                          </div>
                        </div>
                      </div>

                      <AnimatePresence>
                        {showAccumulatedDetails && (
                          <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            exit={{ opacity: 0, height: 0 }}
                            className="bg-white rounded-3xl border border-slate-200 overflow-hidden shadow-inner"
                          >
                            <div className="p-4 bg-slate-900 border-b border-slate-800 flex justify-between items-center">
                              <h4 className="text-[10px] font-black text-indigo-400 uppercase tracking-[0.2em] flex items-center gap-2">
                                <div className="w-4 h-1 bg-indigo-500" />
                                Historial de Periodos y Liquidaciones Técnicas
                              </h4>
                              <div className="flex items-center gap-4 text-[9px] font-bold text-slate-400 uppercase italic">
                                <span>* Todos los valores consolidados</span>
                                <div className="flex items-center gap-2 bg-white/5 px-3 py-1 rounded-lg border border-white/10">
                                  <span className="text-emerald-400">Archivado</span>
                                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                                </div>
                              </div>
                            </div>
                            <div className="overflow-x-auto">
                              <table className="w-full text-left border-collapse border-2 border-slate-200 rounded-2xl overflow-hidden shadow-sm bg-white">
                                <thead>
                                  <tr className="bg-slate-900 text-white font-black uppercase text-[9px] tracking-widest divide-x divide-slate-800">
                                    <th className="p-3">Mes / Periodo</th>
                                    <th className="p-3 text-right">Bruto</th>
                                    <th className="p-3 text-right text-rose-400">Deducc.</th>
                                    <th className="p-3 text-right text-indigo-300 bg-indigo-950/30 whitespace-nowrap">Neto Caja</th>
                                    <th className="p-3 text-right text-emerald-400">Prima</th>
                                    <th className="p-3 text-right text-amber-400">Cesantías</th>
                                    <th className="p-3 text-right text-rose-400">Intereses</th>
                                    <th className="p-3 text-right text-violet-400">Vacaciones</th>
                                    <th className="p-3 text-right bg-indigo-600 text-white">Total Patrim</th>
                                    <th className="p-3 text-center">Accs</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100 font-mono text-[10px] bg-white">
                                  {periods.sort((a, b) => b.startDate.localeCompare(a.startDate)).map(p => {
                                    const isCurrent = p.id === selectedPeriodId;
                                    const pGross = isCurrent ? results.all.gross : (p.totalGross || 0);
                                    const pPrima = isCurrent ? results.all.primaProporcional : (p.primaProporcional || 0);
                                    const pCesantias = isCurrent ? results.all.cesantiasProporcional : (p.cesantiasProporcional || 0);
                                    const pIntereses = isCurrent ? results.all.interesesCesantias : (p.interesesCesantias || 0);
                                    const pVacaciones = isCurrent ? results.all.vacacionesProporcional : (p.vacacionesProporcional || 0);
                                    const pTotal = isCurrent ? results.all.totalPatrimonial : (p.totalGrossWithBenefits || 0);
                                    const pDeductions = isCurrent ? results.all.totalDeductions : (p.totalDeductions || 0);
                                    const pNetCash = isCurrent ? results.all.netCash : (pGross - pDeductions);

                                    return (
                                      <tr 
                                        key={p.id} 
                                        onClick={() => {
                                          setSelectedPeriodId(p.id);
                                          if (window.innerWidth < 1024) setShowAccumulatedDetails(false);
                                        }}
                                        className={`hover:bg-indigo-50/50 transition-colors cursor-pointer group divide-x divide-slate-100 ${isCurrent ? 'bg-indigo-50/40' : ''}`}
                                      >
                                        <td className="p-3">
                                          <div className="flex flex-col">
                                            <span className={`text-[10px] font-black uppercase tracking-tight ${isCurrent ? 'text-indigo-700 font-black' : 'text-slate-800'}`}>
                                              {p.name}
                                            </span>
                                            <span className="text-[8px] text-slate-400 italic">{p.startDate} - {p.endDate}</span>
                                          </div>
                                        </td>
                                        <td className="p-3 text-right text-slate-600 font-bold">{formatCurrency(pGross)}</td>
                                        <td className="p-3 text-right text-rose-500">-{formatCurrency(pDeductions)}</td>
                                        <td className="p-3 text-right font-black text-indigo-700 bg-indigo-50/30">{formatCurrency(pNetCash)}</td>
                                        <td className="p-3 text-right text-emerald-600 font-bold">+{formatCurrency(pPrima)}</td>
                                        <td className="p-3 text-right text-amber-600 font-bold">+{formatCurrency(pCesantias)}</td>
                                        <td className="p-3 text-right text-rose-500 font-bold">+{formatCurrency(pIntereses)}</td>
                                        <td className="p-3 text-right text-violet-600 font-bold">+{formatCurrency(pVacaciones)}</td>
                                        <td className="p-3 text-right font-black bg-slate-900 text-white">{formatCurrency(pTotal)}</td>
                                        <td className="p-3 text-center">
                                          <div className="flex items-center justify-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                             <button 
                                              onClick={(e) => { e.stopPropagation(); openEditPeriod(p); }}
                                              className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-white rounded-lg transition-all"
                                              title="Editar Periodo"
                                            >
                                              <Edit className="w-3.5 h-3.5" />
                                            </button>
                                            <button 
                                              onClick={(e) => { e.stopPropagation(); deletePeriod(p.id); }}
                                              className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-white rounded-lg transition-all"
                                              title="Eliminar Registro"
                                            >
                                              <Trash2 className="w-3.5 h-3.5" />
                                            </button>
                                          </div>
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                                <tfoot className="divide-x divide-slate-800 font-mono">
                                  <tr className="bg-slate-900 text-white font-black text-[9px] uppercase tracking-widest">
                                    <td className="p-3">TOTAL ACUMULADO</td>
                                    <td className="p-3 text-right">{formatCurrency(accumulated.gross)}</td>
                                    <td className="p-3 text-right text-rose-400">-{formatCurrency(accumulated.deductions)}</td>
                                    <td className="p-3 text-right bg-white/5 whitespace-nowrap">{formatCurrency(accumulated.gross - accumulated.deductions)}</td>
                                    <td className="p-3 text-right text-emerald-400">+{formatCurrency(accumulated.prima)}</td>
                                    <td className="p-3 text-right text-amber-400">+{formatCurrency(accumulated.cesantias)}</td>
                                    <td className="p-3 text-right text-rose-400">+{formatCurrency(accumulated.intereses)}</td>
                                    <td className="p-3 text-right text-violet-400">+{formatCurrency(accumulated.vacaciones)}</td>
                                    <td className="p-3 text-right bg-white text-slate-900 text-[10px] shadow-[inset_0_2px_4px_rgba(0,0,0,0.1)]">{formatCurrency(accumulated.totalGross)}</td>
                                    <td className="p-3"></td>
                                  </tr>
                                </tfoot>
                              </table>
                            </div>
                            <div className="p-6 bg-indigo-50/50 border-t border-slate-200">
                               <h5 className="text-[10px] font-black text-indigo-600 uppercase tracking-widest mb-4 flex items-center gap-2">
                                  <Info className="w-4 h-4" />
                                  Algoritmo de Consolidación (Validación de Auditoría)
                               </h5>
                               <div className="grid grid-cols-1 md:grid-cols-2 gap-8 text-[11px] leading-relaxed text-slate-600">
                                  <div className="space-y-2">
                                     <p><span className="font-bold text-slate-900">1. Liquidez (Caja):</span> Se calcula sumando el <span className="italic">Bruto (Turnos)</span> de cada periodo y restando las <span className="italic">Deducciones</span> legales y manuales. Esta es la sumatoria de lo que has recibido físicamente en tu cuenta.</p>
                                     <p className="font-mono bg-white p-2 rounded-lg border border-slate-200">
                                        Σ(Bruto) - Σ(Deducciones) = {formatCurrency(accumulated.gross - accumulated.deductions)}
                                     </p>
                                  </div>
                                  <div className="space-y-2">
                                     <p><span className="font-bold text-slate-900">2. Patrimonio Total:</span> Es la sumatoria de la liquidez más las <span className="italic">Provisiones Prestacionales</span> (Primas, Cesantías, Vacaciones). Este valor representa la riqueza real generada antes de impuestos efectivos, incluyendo ahorros obligatorios.</p>
                                     <p className="font-mono bg-slate-900 p-2 rounded-lg text-indigo-300">
                                        Saldo Caja + Σ(Prestaciones) = {formatCurrency(accumulated.totalGross)}
                                     </p>
                                  </div>
                               </div>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  );
                })()}
              </div>
            </div>
          </section>
        </main>
      </div>

      <AnimatePresence>
          {showHistoricalModal && (
            <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
              <motion.div 
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 20 }}
                className="bg-white w-full max-w-md rounded-[32px] shadow-2xl overflow-hidden border border-slate-100"
              >
                <div className="p-6 bg-emerald-600 text-white flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Archive className="w-5 h-5" />
                    <h3 className="font-bold uppercase tracking-tight">Registro Histórico Manual</h3>
                  </div>
                  <button onClick={() => setShowHistoricalModal(false)} className="p-1 hover:bg-white/20 rounded-lg">
                    <X className="w-5 h-5" />
                  </button>
                </div>
                
                <div className="p-8 space-y-6">
                  <p className="text-sm text-slate-500 leading-relaxed">
                    Ingresa periodos anteriores manualmente para alimentar los promedios de prestaciones sociales (Prima, Cesantías, Vacaciones).
                  </p>

                  <div className="space-y-4">
                    <div>
                      <label className="block text-[10px] font-black text-slate-400 uppercase mb-1.5 tracking-wider">Nombre del Periodo</label>
                      <input 
                        type="text"
                        placeholder="Ej: Enero 2026"
                        value={historicalData.name}
                        onChange={(e) => setHistoricalData({ ...historicalData, name: e.target.value })}
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl py-3 px-4 text-sm focus:ring-2 focus:ring-emerald-500 outline-none transition-all"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-[10px] font-black text-slate-400 uppercase mb-1.5 tracking-wider">Mes</label>
                        <select 
                          value={historicalData.month}
                          onChange={(e) => setHistoricalData({ ...historicalData, month: Number(e.target.value) })}
                          className="w-full bg-slate-50 border border-slate-200 rounded-xl py-3 px-4 text-sm focus:ring-2 focus:ring-emerald-500 outline-none transition-all"
                        >
                          {Array.from({ length: 12 }, (_, i) => (
                            <option key={i + 1} value={i + 1}>
                              {new Date(2026, i).toLocaleString('es-ES', { month: 'long' })}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-[10px] font-black text-slate-400 uppercase mb-1.5 tracking-wider">Año</label>
                        <input 
                          type="number"
                          value={historicalData.year}
                          onChange={(e) => setHistoricalData({ ...historicalData, year: Number(e.target.value) })}
                          className="w-full bg-slate-50 border border-slate-200 rounded-xl py-3 px-4 text-sm focus:ring-2 focus:ring-emerald-500 outline-none transition-all font-mono"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-[10px] font-black text-slate-400 uppercase mb-1.5 tracking-wider">Salario Bruto (Turnos)</label>
                      <div className="relative">
                        <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                        <input 
                          type="number"
                          value={historicalData.gross}
                          onChange={(e) => setHistoricalData({ ...historicalData, gross: Number(e.target.value) })}
                          className="w-full bg-slate-50 border border-slate-200 rounded-xl py-3 pl-10 pr-4 text-sm focus:ring-2 focus:ring-emerald-500 outline-none transition-all font-mono font-bold text-emerald-600"
                        />
                      </div>
                      <p className="text-[9px] text-slate-400 mt-1 italic">Este valor se usará para promediar las prestaciones sociales del semestre y año.</p>
                    </div>
                  </div>

                  <div className="flex gap-3 pt-2">
                    <button 
                      onClick={() => setShowHistoricalModal(false)}
                      className="flex-1 py-4 bg-slate-50 text-slate-600 font-bold rounded-2xl hover:bg-slate-100 transition-all border border-slate-200"
                    >
                      Cancelar
                    </button>
                    <button 
                      onClick={saveHistoricalPeriod}
                      className="flex-1 py-4 bg-emerald-600 text-white font-bold rounded-2xl hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-200"
                    >
                      Registrar Histórico
                    </button>
                  </div>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

      {/* Footer Info */}
      <footer className="bg-slate-900 text-slate-400 p-10 text-center space-y-4">
        <div className="flex items-center justify-center gap-2 text-white">
          <Stethoscope className="w-5 h-5" />
          <span className="font-bold tracking-tight">EMI pagos</span>
        </div>
        <p className="text-xs max-w-md mx-auto leading-relaxed">
          Herramienta diseñada para profesionales de la salud en Colombia. 
          Cálculos basados en la normativa laboral vigente para 2026.
        </p>
        <div className="pt-4 border-t border-slate-800 text-[10px] uppercase tracking-widest">
          © 2026 • Desarrollado para el Gremio Médico
        </div>
      </footer>

      <AnimatePresence>
        {showPeriodSelectionModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-white w-full max-w-md rounded-[32px] shadow-2xl overflow-hidden"
            >
              <div className="p-8 space-y-6">
                <div className="text-center space-y-2">
                  <div className="w-16 h-16 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center mx-auto mb-4">
                    <CheckCircle2 className="w-8 h-8" />
                  </div>
                  <h2 className="text-2xl font-bold text-slate-900">Cambios Guardados</h2>
                  <p className="text-slate-500 text-sm">El periodo ha sido actualizado. ¿Qué deseas hacer ahora?</p>
                </div>

                <div className="space-y-3">
                  <button 
                    onClick={() => {
                      setShowPeriodSelectionModal(false);
                      openNewPeriodModal();
                    }}
                    className="w-full p-4 bg-indigo-600 text-white rounded-2xl font-bold hover:bg-indigo-700 transition-all flex items-center justify-between group"
                  >
                    <div className="flex items-center gap-3">
                      <PlusCircle className="w-5 h-5" />
                      <span>Crear un nuevo periodo</span>
                    </div>
                    <ChevronDown className="w-4 h-4 -rotate-90 opacity-0 group-hover:opacity-100 transition-all" />
                  </button>

                  <div className="relative py-2">
                    <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-slate-100"></div></div>
                    <div className="relative flex justify-center text-[10px] uppercase font-bold text-slate-400 bg-white px-2">O selecciona uno existente</div>
                  </div>

                  <div className="max-h-48 overflow-y-auto space-y-2 pr-2 custom-scrollbar">
                    {periods.map(p => (
                      <button 
                        key={p.id}
                        onClick={() => {
                          setSelectedPeriodId(p.id);
                          setShowPeriodSelectionModal(false);
                          setViewingArchive(null);
                        }}
                        className={`w-full p-3 rounded-xl border text-left transition-all flex items-center justify-between hover:border-indigo-300 hover:bg-indigo-50 ${p.status === 'active' ? 'border-emerald-200 bg-emerald-50/50' : 'border-slate-100 bg-slate-50/50'}`}
                      >
                        <div>
                          <p className="text-xs font-bold text-slate-700">{p.name}</p>
                          <p className="text-[10px] text-slate-500">{p.startDate} - {p.endDate}</p>
                        </div>
                        {p.status === 'active' && <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />}
                      </button>
                    ))}
                  </div>
                </div>

                <button 
                  onClick={() => setShowPeriodSelectionModal(false)}
                  className="w-full py-3 text-slate-500 text-xs font-bold hover:text-slate-700 transition-colors"
                >
                  Cerrar y quedarme aquí
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showTrisemanaModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-3xl shadow-2xl max-w-md w-full overflow-hidden"
            >
              <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-amber-600 text-white">
                <div className="flex items-center gap-3">
                  <Clock className="w-5 h-5" />
                  <h3 className="font-bold">{editingTrisemana ? 'Editar Trisemana' : 'Nueva Trisemana'}</h3>
                </div>
                <button 
                  onClick={() => {
                    setShowTrisemanaModal(false);
                    setEditingTrisemana(null);
                  }} 
                  className="p-1 hover:bg-white/20 rounded-lg transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              
              <div className="p-6 space-y-6">
                <p className="text-sm text-slate-500 leading-relaxed">
                  {editingTrisemana ? 'Actualiza los datos de la trisemana seleccionada.' : 'Define un intervalo de 3 semanas y su tope de horas. Las horas que excedan este tope se calcularán con recargos de horas extra.'}
                </p>
                
                <div className="space-y-4">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1.5 tracking-wider">Nombre (Opcional)</label>
                      <input 
                        type="text"
                        placeholder="Ej: Trisemana Abril A"
                        value={newTrisemanaData.name || ''}
                        onChange={(e) => setNewTrisemanaData({ ...newTrisemanaData, name: e.target.value })}
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl py-3 px-4 text-sm focus:ring-2 focus:ring-amber-500 outline-none transition-all"
                      />
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1.5 tracking-wider">Fecha Inicio</label>
                      <input 
                        type="date"
                        value={newTrisemanaData.startDate || ''}
                        onChange={(e) => setNewTrisemanaData({ ...newTrisemanaData, startDate: e.target.value })}
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl py-3 px-4 text-sm focus:ring-2 focus:ring-amber-500 outline-none transition-all"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1.5 tracking-wider">Fecha Fin</label>
                      <input 
                        type="date"
                        value={newTrisemanaData.endDate || ''}
                        onChange={(e) => setNewTrisemanaData({ ...newTrisemanaData, endDate: e.target.value })}
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl py-3 px-4 text-sm focus:ring-2 focus:ring-amber-500 outline-none transition-all"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1.5 tracking-wider">Tope de Horas (Trisemana)</label>
                    <div className="relative">
                      <input 
                        type="number"
                        value={newTrisemanaData.maxHours || 0}
                        onChange={(e) => setNewTrisemanaData({ ...newTrisemanaData, maxHours: Number(e.target.value) })}
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl py-3 px-4 text-sm focus:ring-2 focus:ring-amber-500 outline-none transition-all font-mono"
                      />
                      <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[10px] font-bold text-slate-400 uppercase">Horas</span>
                    </div>
                  </div>
                </div>
                
                <button 
                  onClick={createTrisemana}
                  className="w-full py-4 bg-amber-600 text-white font-bold rounded-2xl hover:bg-amber-700 transition-all shadow-lg shadow-amber-200 flex items-center justify-center gap-2"
                >
                  <CheckCircle2 className="w-5 h-5" />
                  {editingTrisemana ? 'Guardar Cambios' : 'Crear Trisemana'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showPeriodModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-3xl shadow-2xl max-w-md w-full overflow-hidden"
            >
              <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-indigo-600 text-white">
                <div className="flex items-center gap-3">
                  <Calendar className="w-5 h-5" />
                  <h3 className="font-bold">
                    {editingPeriod ? 'Editar Periodo' : 'Nuevo Periodo de Facturación'}
                  </h3>
                </div>
                <button 
                  onClick={() => {
                    setShowPeriodModal(false);
                    setEditingPeriod(null);
                  }} 
                  className="p-1 hover:bg-white/20 rounded-lg transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              
              <div className="p-6 space-y-6">
                <p className="text-sm text-slate-500 leading-relaxed">
                  {editingPeriod 
                    ? 'Actualiza los datos del periodo seleccionado.' 
                    : 'Al iniciar un nuevo periodo, el actual se archivará y podrás consultarlo más tarde.'}
                </p>
                
                <div className="space-y-4">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1.5 tracking-wider">Nombre del Periodo (Opcional)</label>
                      <input 
                        type="text"
                        placeholder="Ej: Marzo 2026"
                        value={newPeriodData.name || ''}
                        onChange={(e) => setNewPeriodData({ ...newPeriodData, name: e.target.value })}
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl py-3 px-4 text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                      />
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1.5 tracking-wider">Fecha Inicio</label>
                      <input 
                        type="date"
                        value={newPeriodData.startDate || ''}
                        onChange={(e) => setNewPeriodData({ ...newPeriodData, startDate: e.target.value })}
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl py-3 px-4 text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1.5 tracking-wider">Fecha Fin</label>
                      <input 
                        type="date"
                        value={newPeriodData.endDate || ''}
                        onChange={(e) => setNewPeriodData({ ...newPeriodData, endDate: e.target.value })}
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl py-3 px-4 text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1.5 tracking-wider">Límite de Horas para Extras (Threshold)</label>
                    <div className="relative">
                      <Clock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                      <input 
                        type="number"
                        placeholder="Ej: 160"
                        value={newPeriodData.extraThreshold || 0}
                        onChange={(e) => setNewPeriodData({ ...newPeriodData, extraThreshold: Number(e.target.value) })}
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl py-3 pl-10 pr-4 text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all font-mono"
                      />
                      <span className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 text-xs">Horas</span>
                    </div>
                  </div>
                </div>
              </div>
              
              <div className="p-6 bg-slate-50 flex gap-3">
                <button 
                  onClick={() => {
                    setShowPeriodModal(false);
                    setEditingPeriod(null);
                  }}
                  className="flex-1 py-3 border border-slate-200 text-slate-600 font-bold rounded-xl hover:bg-white transition-all"
                >
                  Cancelar
                </button>
                <button 
                  onClick={savePeriod}
                  className="flex-1 py-3 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-200"
                >
                  {editingPeriod ? 'Guardar Cambios' : 'Iniciar Periodo'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showHelp && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-white w-full max-w-sm rounded-[32px] shadow-2xl overflow-hidden"
            >
              <div className="p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-indigo-600">
                    <Info className="w-5 h-5" />
                    <h3 className="font-bold text-slate-900">{showHelp.title}</h3>
                  </div>
                  <button 
                    onClick={() => setShowHelp(null)}
                    className="p-2 hover:bg-slate-100 rounded-xl transition-colors text-slate-400"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <p className="text-sm text-slate-600 leading-relaxed">
                  {showHelp.content}
                </p>
                <button 
                  onClick={() => setShowHelp(null)}
                  className="w-full py-3 bg-slate-900 text-white rounded-2xl font-bold hover:bg-slate-800 transition-all"
                >
                  Entendido
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {confirmDialog && (
          <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-white rounded-[32px] shadow-2xl max-w-sm w-full overflow-hidden border border-slate-100"
            >
              <div className="p-8 space-y-6">
                <div className="flex items-center gap-4">
                  <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 ${
                    confirmDialog.type === 'delete' ? 'bg-rose-100 text-rose-600' : 'bg-indigo-100 text-indigo-600'
                  }`}>
                    {confirmDialog.type === 'delete' ? <Trash2 className="w-6 h-6" /> : <Edit3 className="w-6 h-6" />}
                  </div>
                  <div className="space-y-1">
                    <h3 className="text-xl font-bold text-slate-900">
                      {confirmDialog.title || 'Confirmar Acción'}
                    </h3>
                    <p className="text-sm text-slate-500 leading-relaxed font-medium">
                      {confirmDialog.message}
                    </p>
                  </div>
                </div>

                {confirmDialog.changes && confirmDialog.changes.length > 0 && (
                  <div className="bg-slate-50 rounded-2xl p-4 space-y-3 border border-slate-100 max-h-60 overflow-y-auto custom-scrollbar">
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest pl-1">Resumen de Cambios:</p>
                    <div className="space-y-2">
                      {confirmDialog.changes.map((change, i) => (
                        <div key={i} className="bg-white p-3 rounded-xl border border-slate-100 shadow-sm">
                          <p className="text-[9px] font-black text-indigo-500 uppercase tracking-tighter mb-1">{change.field}</p>
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] text-slate-400 line-through truncate flex-1">{change.old || '(Vacío)'}</span>
                            <Plus className="w-3 h-3 text-slate-300 shrink-0 rotate-45" />
                            <span className="text-[10px] text-emerald-600 font-bold truncate flex-1">{change.new || '(Vacío)'}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="flex gap-3 pt-2">
                  <button 
                    onClick={() => setConfirmDialog(null)}
                    className="flex-1 py-4 bg-slate-50 text-slate-600 font-bold rounded-2xl hover:bg-slate-100 transition-all border border-slate-200"
                  >
                    Cancelar
                  </button>
                  <button 
                    onClick={() => {
                      confirmDialog.onConfirm();
                      setConfirmDialog(null);
                    }}
                    className={`flex-1 py-4 text-white font-bold rounded-2xl transition-all shadow-lg hover:brightness-110 ${
                      confirmDialog.type === 'delete' ? 'bg-rose-600 shadow-rose-200' : 'bg-indigo-600 shadow-indigo-200'
                    }`}
                  >
                    {confirmDialog.confirmLabel || 'Confirmar'}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {showConfigConfirmModal && (
        <ConfigConfirmModal 
          diffs={configDiffs}
          onConfirm={confirmConfigChanges}
          onCancel={discardConfigChanges}
        />
      )}
    </div>
  );
}

function ConfigConfirmModal({ diffs, onConfirm, onCancel }: { 
  diffs: { label: string, old: any, new: any }[], 
  onConfirm: () => void, 
  onCancel: () => void 
}) {
  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[200] flex items-center justify-center p-4">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="bg-white rounded-[32px] shadow-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh] border border-slate-100"
      >
        <div className="p-8 border-b border-slate-50 bg-slate-50/30 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-indigo-100 text-indigo-600 rounded-2xl flex items-center justify-center shadow-inner">
              <ShieldCheck className="w-7 h-7" />
            </div>
            <div>
              <h2 className="text-xl font-black text-slate-900 uppercase tracking-tight">Confirmar Ajustes</h2>
              <p className="text-xs text-slate-500 font-bold uppercase tracking-widest opacity-60">Resumen de cambios realizados</p>
            </div>
          </div>
          <button onClick={onCancel} className="p-2 text-slate-300 hover:text-slate-900 transition-colors">
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="p-8 overflow-y-auto custom-scrollbar flex-1 bg-white">
          <div className="space-y-6">
            <div className="flex items-start gap-3 p-4 bg-amber-50 text-amber-700 rounded-2xl border border-amber-100 shadow-sm">
              <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
              <div>
                <h4 className="text-[10px] font-black uppercase mb-1">Aviso de Seguridad</h4>
                <p className="text-[10px] font-bold leading-relaxed opacity-80">
                  Estás modificando parámetros clave que alteran el cálculo de tus ingresos. Por favor, verifica que las nuevas tarifas coincidan con tu contrato vigente.
                </p>
              </div>
            </div>

            <div className="space-y-3">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest pl-1">Lista de Modificaciones ({diffs.length}):</p>
              <div className="space-y-2">
                {diffs.map((diff, index) => (
                  <div key={index} className="group p-4 bg-slate-50 rounded-2xl border border-slate-100 hover:border-indigo-200 transition-all">
                    <p className="text-[9px] font-black text-indigo-500 uppercase mb-2 tracking-tighter">{diff.label}</p>
                    <div className="flex items-center gap-3">
                      <div className="flex-1 bg-white p-2 rounded-xl text-center shadow-sm border border-slate-50">
                        <span className="block text-[8px] text-slate-400 font-bold uppercase mb-0.5">Anterior</span>
                        <span className="text-xs font-mono text-slate-400 line-through">
                          {typeof diff.old === 'number' ? formatCurrency(diff.old) : diff.old}
                        </span>
                      </div>
                      <div className="shrink-0 flex items-center justify-center p-1 bg-indigo-50 text-indigo-300 rounded-full">
                        <ChevronRight className="w-4 h-4" />
                      </div>
                      <div className="flex-1 bg-emerald-50 p-2 rounded-xl text-center shadow-sm border border-emerald-100">
                        <span className="block text-[8px] text-emerald-600 font-bold uppercase mb-0.5">Nuevo</span>
                        <span className="text-xs font-mono font-black text-emerald-700">
                          {typeof diff.new === 'number' ? formatCurrency(diff.new) : diff.new}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="p-8 bg-slate-50/50 border-t border-slate-100 flex items-center gap-4">
          <button 
            onClick={onCancel}
            className="flex-1 py-4 bg-white border border-slate-200 text-slate-600 font-black uppercase tracking-widest text-[10px] rounded-2xl hover:bg-slate-50 transition-all shadow-sm"
          >
            Descartar
          </button>
          <button 
            onClick={onConfirm}
            className="flex-1 py-4 bg-indigo-600 text-white rounded-2xl font-black uppercase tracking-widest text-[10px] hover:bg-indigo-700 transition-all shadow-[0_8px_16px_-4px_rgba(79,70,229,0.3)] active:scale-95"
          >
            Guardar Cambios
          </button>
        </div>
      </motion.div>
    </div>
  );
}

// --- Main Export ---
export default function App() {
  return (
    <ErrorBoundary>
      <MainApp />
    </ErrorBoundary>
  );
}

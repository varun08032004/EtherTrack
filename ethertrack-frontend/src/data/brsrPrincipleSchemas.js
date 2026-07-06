// src/data/brsrPrincipleSchemas.js
// Field schemas for SEBI BRSR Section C principles, driving the generic
// BRSRPrincipleForm.jsx renderer. P6 (Environment) is NOT here — it stays
// on its own bespoke BRSREnvironmental.jsx since it was built before this
// pattern existed and has GHG-ledger sync logic that doesn't fit the
// generic shape.
//
// Field types supported by BRSRPrincipleForm: 'radio' | 'number' | 'percent'
// | 'text' | 'textarea' | 'select' | 'table'
// `showIf: { key, equals }` makes a field conditional on another field's value.
// `required: false` marks a field as Leadership-style optional even inside
// the essential list (rare — most essential fields are required by default).

export const PRINCIPLE_SCHEMAS = {

  p1: {
    label: 'P1', name: 'Ethics, Transparency & Accountability',
    essential: [
      { key: 'hasAntiCorruptionPolicy', type: 'radio', label: 'Does the entity have an anti-corruption / anti-bribery policy?' },
      { key: 'antiCorruptionTrainingPct', type: 'percent', label: '% of Board/KMP/Employees/Workers covered by anti-corruption training', showIf: { key: 'hasAntiCorruptionPolicy', equals: true } },
      { key: 'conflictComplaintsFiled', type: 'number', label: 'Complaints received regarding conflict of interest (this FY)' },
      { key: 'conflictComplaintsResolved', type: 'number', label: 'Of those, complaints resolved' },
      { key: 'finesPenalties', type: 'number', label: 'Monetary fines/penalties/settlements paid (₹ Lakh, this FY)' },
      { key: 'finesPenaltiesDetails', type: 'textarea', label: 'Details of proceedings (regulator, NCLT, judicial, etc.)', showIf: { key: 'finesPenalties', equals: 'gt0' } },
      { key: 'accountsPayableDays', type: 'number', label: 'Number of days of accounts payable' },
      { key: 'relatedPartyPurchasePct', type: 'percent', label: '% of purchases from related parties' },
      { key: 'relatedPartySalesPct', type: 'percent', label: '% of sales to related parties' },
    ],
    leadership: [
      { key: 'valueChainAwarenessPct', type: 'percent', label: '% of value chain partners covered by anti-corruption awareness programmes' },
      { key: 'valueChainRBCProcess', type: 'textarea', label: 'Processes in place for responsible business conduct in the value chain' },
    ],
  },

  p2: {
    label: 'P2', name: 'Product Lifecycle Sustainability & Safety',
    essential: [
      { key: 'rdSustainabilityPct', type: 'percent', label: '% of R&D investment in sustainability/safety-related areas' },
      { key: 'capexSustainabilityPct', type: 'percent', label: '% of capex investment in sustainability/safety-related areas' },
      { key: 'sustainableSourcingPct', type: 'percent', label: '% of total sourcing that is sustainable' },
      { key: 'hasEprProcess', type: 'radio', label: 'Does the entity have a product reclamation/recycling/EPR process?' },
      { key: 'eprCoveragePct', type: 'percent', label: '% of products covered by reclamation/EPR process', showIf: { key: 'hasEprProcess', equals: true } },
    ],
    leadership: [
      { key: 'hasLCA', type: 'radio', label: 'Has a Life Cycle Assessment (LCA) been conducted for products/services?' },
      { key: 'lcaCoveragePct', type: 'percent', label: '% of products/services covered by LCA', showIf: { key: 'hasLCA', equals: true } },
      { key: 'recycledInputPct', type: 'percent', label: '% recycled/reused input material used' },
    ],
  },

  p3: {
    label: 'P3', name: 'Employee & Worker Wellbeing',
    essential: [
      {
        key: 'benefitsCoverage', type: 'table', label: 'Benefit coverage by category (% covered)',
        columns: [
          { key: 'benefit', label: 'BENEFIT', type: 'select', options: ['Health Insurance', 'Accident Insurance', 'Maternity Benefits', 'Paternity Benefits', 'Day Care Facility'], width: 2 },
          { key: 'permanentEmpPct', label: 'PERMANENT EMP %', type: 'number', width: 1 },
          { key: 'otherEmpPct', label: 'OTHER EMP %', type: 'number', width: 1 },
          { key: 'permanentWorkerPct', label: 'PERMANENT WORKER %', type: 'number', width: 1 },
          { key: 'otherWorkerPct', label: 'OTHER WORKER %', type: 'number', width: 1 },
        ],
      },
      {
        key: 'retirementBenefits', type: 'table', label: 'Retirement benefit coverage (% covered)',
        columns: [
          { key: 'benefit', label: 'BENEFIT', type: 'select', options: ['PF', 'Gratuity', 'ESI'], width: 2 },
          { key: 'employeesPct', label: 'EMPLOYEES %', type: 'number', width: 1 },
          { key: 'workersPct', label: 'WORKERS %', type: 'number', width: 1 },
        ],
      },
      { key: 'accessibleForDifferentlyAbled', type: 'radio', label: 'Are workplaces accessible for differently abled employees/workers?' },
      { key: 'equalOpportunityPolicy', type: 'radio', label: 'Does the entity have an equal opportunity policy?' },
      { key: 'returnToWorkRateEmp', type: 'percent', label: 'Return-to-work rate after parental leave — Employees' },
      { key: 'returnToWorkRateWorker', type: 'percent', label: 'Return-to-work rate after parental leave — Workers' },
      { key: 'workingConditionsComplaintsFiled', type: 'number', label: 'Complaints on working conditions/health & safety filed (this FY)' },
      { key: 'workingConditionsComplaintsPending', type: 'number', label: 'Of those, still pending' },
      {
        key: 'safetyIncidents', type: 'table', label: 'Safety incidents (this FY)',
        columns: [
          { key: 'metric', label: 'METRIC', type: 'select', options: ['LTIFR (per million hrs)', 'Total Recordable Injuries', 'Fatalities', 'High-Consequence Injuries'], width: 2 },
          { key: 'employees', label: 'EMPLOYEES', type: 'number', width: 1 },
          { key: 'workers', label: 'WORKERS', type: 'number', width: 1 },
        ],
      },
      {
        key: 'trainingCoverage', type: 'table', label: 'Training coverage — health & safety / skill upgradation (%)',
        columns: [
          { key: 'category', label: 'CATEGORY', type: 'select', options: ['Permanent Employees', 'Other Employees', 'Permanent Workers', 'Other Workers'], width: 2 },
          { key: 'healthSafetyPct', label: 'HEALTH & SAFETY %', type: 'number', width: 1 },
          { key: 'skillUpgradePct', label: 'SKILL UPGRADE %', type: 'number', width: 1 },
        ],
      },
    ],
    leadership: [
      { key: 'valueChainHSAssessed', type: 'percent', label: '% of value chain partners assessed for health & safety / working conditions' },
      { key: 'valueChainIncidents', type: 'number', label: 'Number of safety incidents among value chain workers (this FY)' },
      { key: 'valueChainCorrectiveActions', type: 'textarea', label: 'Corrective actions taken on value chain findings' },
      { key: 'unionMembershipPct', type: 'percent', label: '% of employees/workers in an association or union' },
      { key: 'careerReviewCoveragePct', type: 'percent', label: '% of employees covered by performance/career development reviews' },
    ],
  },

  p4: {
    label: 'P4', name: 'Stakeholder Engagement',
    essential: [
      { key: 'stakeholderIdentificationProcess', type: 'textarea', label: 'Process for identifying key stakeholder groups' },
      { key: 'consultationUndertaken', type: 'radio', label: 'Was stakeholder consultation undertaken for any key business decision?' },
      { key: 'consultationDetails', type: 'textarea', label: 'Frequency and topics of consultation', showIf: { key: 'consultationUndertaken', equals: true } },
    ],
    leadership: [
      { key: 'vulnerableGroupEngagement', type: 'textarea', label: 'Details of engagement with vulnerable/marginalised stakeholder groups' },
      { key: 'stakeholderConcernsResponse', type: 'textarea', label: 'Key concerns raised by stakeholders and the entity\u2019s response' },
    ],
  },

  p5: {
    label: 'P5', name: 'Human Rights',
    essential: [
      {
        key: 'hrTrainingCoverage', type: 'table', label: 'Human rights training coverage (%)',
        columns: [
          { key: 'group', label: 'GROUP', type: 'select', options: ['Employees', 'Workers', 'Value Chain Partners', 'Security Personnel'], width: 2 },
          { key: 'coveragePct', label: 'COVERAGE %', type: 'number', width: 1 },
        ],
      },
      {
        key: 'minimumWageCompliance', type: 'table', label: 'Minimum wage compliance — % paid at or above minimum wage',
        columns: [
          { key: 'category', label: 'CATEGORY', type: 'select', options: ['Male Employees', 'Female Employees', 'Male Workers', 'Female Workers'], width: 2 },
          { key: 'pct', label: '%', type: 'number', width: 1 },
        ],
      },
      { key: 'femaleWagesPct', type: 'percent', label: 'Gross wages paid to females as % of total wages' },
      { key: 'hrGrievanceFocalPoint', type: 'radio', label: 'Is there a focal point/Committee for human rights grievances?' },
      {
        key: 'hrComplaints', type: 'table', label: 'Human rights complaints (this FY)',
        columns: [
          { key: 'type', label: 'TYPE', type: 'select', options: ['Sexual Harassment (POSH)', 'Discrimination', 'Child Labour', 'Forced Labour', 'Wages', 'Other'], width: 2 },
          { key: 'filed', label: 'FILED', type: 'number', width: 1 },
          { key: 'pending', label: 'PENDING', type: 'number', width: 1 },
        ],
      },
      { key: 'antiRetaliationMechanism', type: 'radio', label: 'Are there mechanisms to prevent adverse consequences to complainants?' },
      { key: 'premisesAssessedPct', type: 'percent', label: '% of plants/offices assessed for human rights risks' },
      { key: 'hrCorrectiveActions', type: 'textarea', label: 'Corrective actions taken on human rights findings' },
    ],
    leadership: [
      { key: 'broaderHrApproach', type: 'textarea', label: 'Broader approach to managing human rights' },
      { key: 'processesModifiedPostGrievance', type: 'textarea', label: 'Business processes modified following a human rights grievance' },
      { key: 'hrDueDiligenceScope', type: 'textarea', label: 'Scope and coverage of human rights due diligence across the value chain' },
    ],
  },

  p7: {
    label: 'P7', name: 'Responsible Public Policy',
    essential: [
      { key: 'tradeAssociationMemberships', type: 'textarea', label: 'Trade/industry chambers and associations the entity is a member of' },
      { key: 'anticompetitiveIssues', type: 'radio', label: 'Were there any anti-competitive conduct issues this FY?' },
      { key: 'anticompetitiveCorrectiveAction', type: 'textarea', label: 'Corrective action taken / underway', showIf: { key: 'anticompetitiveIssues', equals: true } },
    ],
    leadership: [
      { key: 'publicPolicyPositions', type: 'textarea', label: 'Public policy positions advocated and engagement details' },
    ],
  },

  p8: {
    label: 'P8', name: 'Inclusive Growth & Equitable Development',
    essential: [
      { key: 'siaConducted', type: 'radio', label: 'Were Social Impact Assessments (SIA) conducted for projects this FY?' },
      { key: 'siaCoveragePct', type: 'percent', label: '% of projects covered by SIA', showIf: { key: 'siaConducted', equals: true } },
      { key: 'rAndRDetails', type: 'textarea', label: 'Rehabilitation & Resettlement (R&R) details, if applicable' },
      { key: 'communityGrievanceMechanism', type: 'radio', label: 'Is there a community grievance redressal mechanism in place?' },
      { key: 'msmeSourcingPct', type: 'percent', label: '% of input material sourced from MSMEs/small producers' },
      { key: 'domesticSourcingPct', type: 'percent', label: '% of input material sourced directly within India' },
      { key: 'csrBeneficiaries', type: 'number', label: 'Number of CSR project beneficiaries (this FY)' },
      { key: 'csrBeneficiaryDetails', type: 'textarea', label: 'Description of CSR projects and beneficiaries' },
    ],
    leadership: [
      { key: 'valueChainNegativeImpactActions', type: 'textarea', label: 'Actions to identify negative social impacts in the value chain' },
      { key: 'aspirationalDistrictsPct', type: 'percent', label: '% of CSR projects in government-identified aspirational districts' },
    ],
  },

  p9: {
    label: 'P9', name: 'Consumer Responsibility',
    essential: [
      { key: 'consumerInfoMechanism', type: 'textarea', label: 'Mechanisms to inform consumers about goods/services (advertising, labelling)' },
      { key: 'productRecallPct', type: 'percent', label: '% of turnover from products recalled (voluntary or forced) this FY' },
      { key: 'productRecallReasons', type: 'textarea', label: 'Reasons for recall', showIf: { key: 'productRecallPct', equals: 'gt0' } },
      {
        key: 'consumerComplaints', type: 'table', label: 'Consumer complaints (this FY)',
        columns: [
          { key: 'category', label: 'CATEGORY', type: 'select', options: ['Data Privacy', 'Advertising', 'Cyber-security', 'Delivery of Essential Services', 'Restrictive Trade Practices', 'Other'], width: 2 },
          { key: 'filed', label: 'FILED', type: 'number', width: 1 },
          { key: 'pending', label: 'PENDING', type: 'number', width: 1 },
        ],
      },
      { key: 'labellingCorrectiveActions', type: 'textarea', label: 'Corrective actions on product labelling/marketing claims/data privacy' },
      { key: 'riskyUseMechanism', type: 'radio', label: 'Is there a mechanism to inform consumers of risky/dangerous product use?' },
    ],
    leadership: [
      { key: 'consumerFeedbackChannels', type: 'textarea', label: 'Channels/processes for consumers to provide feedback' },
      { key: 'responsibleAdvertisingPolicy', type: 'radio', label: 'Has a responsible advertising/communication policy been adopted?' },
      { key: 'responsibleAdvertisingFramework', type: 'textarea', label: 'Framework details (origin, composition, handling, disposal, safety)', showIf: { key: 'responsibleAdvertisingPolicy', equals: true } },
    ],
  },
};
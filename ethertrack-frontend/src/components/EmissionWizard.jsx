// EmissionWizard.jsx — Step-by-step emission calculation wizard
// Phase 1: Carbon Intelligence - Scope 1/2/3 Guidance Wizard

import React, { useState, useEffect, useCallback } from 'react';
import { Box, Button, TextField, Select, MenuItem, FormControl, InputLabel, Grid, Typography, Alert, AlertTitle, CircularProgress, Stepper, Step, StepLabel, Paper, Divider, Tooltip, IconButton, Autocomplete, Chip, Accordion, AccordionSummary, AccordionDetails, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TableFooter } from '@mui/material';
import { ChevronLeft, ChevronRight, Plus, Trash2, Save, Download, Search, Info, AlertTriangle, CheckCircle, AlertCircle, Calculator } from 'lucide-react';
import { emissionsAPI } from '../services/api';
import { useSnackbar } from 'notistack';

const STEPS = [
  { key: 'methodology', label: 'Methodology', description: 'Choose reporting standard' },
  { key: 'category', label: 'Activity', description: 'Select emission activity' },
  { key: 'input', label: 'Data Entry', description: 'Enter quantity and details' },
  { key: 'review', label: 'Review', description: 'Verify calculation' }
];

const METHODOLOGIES = [
  { code: 'GHG_PROTOCOL_CORPORATE', name: 'GHG Protocol Corporate Standard', scopes: [1,2,3], description: 'Most widely used global standard for corporate GHG accounting' },
  { code: 'ISO_14064_1', name: 'ISO 14064-1:2018', scopes: [1,2,3], description: 'International standard for organization-level GHG quantification' },
  { code: 'BRSR_CORE', name: 'SEBI BRSR Core', scopes: [1,2], description: 'SEBI Business Responsibility and Sustainability Reporting' },
  { code: 'PAT', name: 'PAT Scheme (BEE)', scopes: [1,2], description: 'Perform, Achieve and Trade - Energy efficiency compliance' },
  { code: 'CCTS', name: 'CCTS Compliance', scopes: [1,2], description: 'India Carbon Credit Trading Scheme - GEI calculation' }
];

const SCOPE_LABELS = {
  1: 'Scope 1 - Direct Emissions',
  2: 'Scope 2 - Indirect Energy Emissions',
  3: 'Scope 3 - Value Chain Emissions'
};

export default function EmissionWizard({ onComplete, initialData }) {
  const { enqueueSnackbar } = useSnackbar();
  const [activeStep, setActiveStep] = useState(0);
  const [methodology, setMethodology] = useState('');
  const [category, setCategory] = useState('');
  const [formData, setFormData] = useState({
    quantity: '',
    unit: '',
    date: new Date().toISOString().split('T')[0],
    factorCode: '',
    description: '',
    facilityId: '',
  });
  const [factors, setFactors] = useState([]);
  const [suggestedFactor, setSuggestedFactor] = useState(null);
  const [factorLoading, setFactorLoading] = useState(false);
  const [unitOptions, setUnitOptions] = useState([]);
  const [requiredFields, setRequiredFields] = useState([]);
  const [calculationResult, setCalculationResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [categories, setCategories] = useState([]);
  const [categoriesLoading, setCategoriesLoading] = useState(false);

  useEffect(() => {
    if (methodology) {
      setCategoriesLoading(true);
      emissionsAPI.getActivityCategories({ methodology })
        .then(res => {
          setCategories(res.data || res);
          setCategoriesLoading(false);
        })
        .catch(err => {
          enqueueSnackbar(`Failed to load categories: ${err.message}`, { variant: 'error' });
          setCategoriesLoading(false);
        });
    } else {
      setCategories([]);
    }
  }, [methodology, enqueueSnackbar]);

  useEffect(() => {
    if (category) {
      setFactorLoading(true);
      emissionsAPI.getEmissionFactors({ category, methodology })
        .then(res => {
          const data = res.data || res;
          setFactors(data);
          if (data.length > 0) {
            const suggested = data.find(f => f.isDefault) || data[0];
            setSuggestedFactor(suggested);
            setFormData(prev => ({ ...prev, factorCode: suggested.code, unit: suggested.unit }));
          }
          setFactorLoading(false);
        })
        .catch(err => {
          enqueueSnackbar(`Failed to load factors: ${err.message}`, { variant: 'error' });
          setFactorLoading(false);
        });
    }
  }, [category, methodology, enqueueSnackbar]);

  useEffect(() => {
    if (formData.factorCode && formData.quantity && formData.unit) {
      const factor = factors.find(f => f.code === formData.factorCode);
      if (factor) {
        emissionsAPI.calculateEmissions({
          factorCode: formData.factorCode,
          activityValue: parseFloat(formData.quantity),
          unit: formData.unit,
          date: formData.date,
        }).then(res => {
          setCalculationResult(res.data || res);
        }).catch(err => {
          enqueueSnackbar(`Calculation failed: ${err.message}`, { variant: 'error' });
        });
      }
    }
  }, [formData.factorCode, formData.quantity, formData.unit, factors]);

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
    setCalculationResult(null);
  };

  const handleFactorChange = (factorCode) => {
    const factor = factors.find(f => f.code === factorCode);
    if (factor) {
      setFormData(prev => ({ ...prev, factorCode, unit: factor.unit }));
      setUnitOptions([factor.unit]);
      setRequiredFields(factor.requiredFields || []);
      setSuggestedFactor(factor);
    }
  };

  const handleBack = () => setActiveStep(prev => Math.max(0, prev - 1));
  const handleNext = () => setActiveStep(prev => Math.min(STEPS.length - 1, prev + 1));
  const handleSubmit = async () => {
    setLoading(true);
    try {
      const result = await emissionsAPI.logEmissionActivity({
        ...formData,
        methodology,
        category,
        calculatedEmissions: calculationResult?.emissions || 0,
        emissionsUnit: 'tCO2e',
      });
      enqueueSnackbar('Emission activity logged successfully!', { variant: 'success' });
      if (onComplete) onComplete(result);
    } catch (err) {
      enqueueSnackbar(`Failed to log activity: ${err.message}`, { variant: 'error' });
    } finally {
      setLoading(false);
    }
  };

  // Step 1: Methodology Selection
  function MethodologyStep({ methodology, setMethodology, onNext }) {
    return (
      <Box>
        <Typography variant="h6" gutterBottom>Select Reporting Methodology</Typography>
        <Typography variant="body2" color="text.secondary" paragraph>
          Choose the reporting standard that applies to your organization. Each methodology defines different scopes and categories.
        </Typography>
        
        <Grid container spacing={2} mt={2}>
          {METHODOLOGIES.map((m) => (
            <Grid item xs={12} sm={6} lg={4} key={m.code}>
              <Paper
                elevation={methodology === m.code ? 3 : 1}
                sx={{ 
                  p: 2, 
                  cursor: 'pointer',
                  border: methodology === m.code ? '2px solid' : '1px solid transparent',
                  borderColor: 'primary.main',
                  transition: 'all 0.2s'
                }}
                onClick={() => setMethodology(m.code)}
              >
                <Typography variant="h6" gutterBottom>{m.name}</Typography>
                <Typography variant="body2" color="text.secondary" paragraph>
                  {m.description}
                </Typography>
                <Box sx={{ display: 'flex', gap: 1, mt: 1 }}>
                  {m.scopes.map(s => (
                    <Chip key={s} label={`Scope ${s}`} size="small" variant="outlined" color="primary" />
                  ))}
                </Box>
              </Paper>
            </Grid>
          ))}
          
          {methodology && (
            <Box mt={3} sx={{ textAlign: 'center' }}>
              <Button variant="contained" onClick={onNext} size="large">
                Continue to Activity Selection
              </Button>
            </Box>
          )}
        </Grid>
        </Box>
      );
  }

  // Step 2: Category Selection
  function CategoryStep({ categories, category, setCategory, methodology, onBack, onNext }) {
    if (!categories.length) {
      return (
        <Box sx={{ textAlign: 'center', py: 6 }}>
          <CircularProgress />
          <Typography variant="body1" color="text.secondary" sx={{ mt: 2 }}>
            Loading activity categories...
          </Typography>
        </Box>
      );
    }

    return (
      <Box>
        <Typography variant="h6" gutterBottom>Select Emission Activity</Typography>
        <Typography variant="body2" color="text.secondary" paragraph>
          Choose the specific emission source. Categories are organized by GHG Protocol scope.
        </Typography>

        <Accordion sx={{ mt: 2 }}>
          {categories
            .reduce((acc, cat) => {
              if (!acc[cat.ghgScope]) acc[cat.ghgScope] = [];
              acc[cat.ghgScope].push(cat);
              return acc;
            }, {})
          .map((scopeCats, scope) => (
            <Accordion key={scope} defaultExpanded={scope === 1}>
              <AccordionSummary expandIcon={<ChevronRight />}>
                <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                  {SCOPE_LABELS[scope]} ({scopeCats.length} activities)
                </Typography>
              </AccordionSummary>
              <AccordionDetails>
                <Grid container spacing={2}>
                  {scopeCats.map((cat) => (
                    <Grid item xs={12} sm={6} lg={4} key={cat.categoryCode}>
                      <Paper
                        elevation={category === cat.categoryCode ? 2 : 0}
                        sx={{ 
                          p: 2, 
                          cursor: 'pointer',
                          border: category === cat.categoryCode ? '2px solid #3b82f6' : '1px solid #e5e7eb',
                          transition: 'all 0.2s',
                          minHeight: 160
                        }}
                        onClick={() => setCategory(cat.categoryCode)}
                      >
                        <Typography variant="subtitle1" gutterBottom fontWeight={600}>
                          {cat.name}
                        </Typography>
                        <Typography variant="body2" color="text.secondary" paragraph>
                          {cat.description}
                        </Typography>
                        <Box sx={{ display: 'flex', gap: 1, mt: 1 }}>
                          <Chip key={cat.ghgScope} label={`Scope ${cat.ghgScope}`} size="small" variant="outlined" />
                          {cat.suggestedFactorId && <Chip key="factor" label="Has default factor" size="small" variant="outlined" color="success" />}
                        </Box>
                      </Paper>
                    </Grid>
                  ))}
                </Grid>
              </AccordionDetails>
            </Accordion>
          ))}
        </Accordion>

        {category && (
          <Box mt={3} sx={{ textAlign: 'center' }}>
            <Box sx={{ display: 'flex', gap: 2, justifyContent: 'center' }}>
              <Button variant="outlined" onClick={onBack} startIcon={<ChevronLeft />}>
                Back
              </Button>
              <Button variant="contained" onClick={onNext} endIcon={<ChevronRight />}>
                Continue to Data Entry
              </Button>
            </Box>
          </Box>
        )}
      </Box>
    );
  }

  // Step 3: Data Entry
  function InputStep({
    formData,
    handleInputChange,
    categories,
    category,
    factors,
    suggestedFactor,
    factorLoading,
    unitOptions,
    requiredFields,
    calculationResult,
    loading,
    onBack,
    onNext,
    onSubmit,
  }) {
    const selectedCategory = categories.find(c => c.categoryCode === category);
    return (
      <Box>
        <Typography variant="h6" gutterBottom>Enter Activity Data</Typography>
        <Typography variant="body2" color="text.secondary" paragraph>
          Provide the activity data for emission calculation. All calculations are performed server-side using tamper-proof emission factors.
        </Typography>

        {category && (
          <Paper elevation={1} sx={{ p: 3, mt: 2, mb: 2 }}>
            <Typography variant="subtitle1" gutterBottom>
              Selected Activity: <strong>{selectedCategory?.name}</strong>
            </Typography>
            <Typography variant="body2" color="text.secondary" paragraph>
              {selectedCategory?.description}
            </Typography>
          </Paper>
        )}

        <Grid container spacing={3} sx={{ mt: 2 }}>
          <Grid item xs={12} sm={6}>
            <FormControl fullWidth size="small">
              <InputLabel id="factor-label">Emission Factor</InputLabel>
              <Select
                labelId="factor-label"
                value={formData.factorCode}
                label="Emission Factor"
                onChange={(e) => handleFactorChange(e.target.value)}
              >
                {factors.map(f => (
                  <MenuItem key={f.code} value={f.code}>
                    {f.name} ({f.value} {f.unit}/{f.activityUnit}) {f.isDefault && '✓ Default'}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            {factorLoading && <Typography variant="caption" color="text.secondary">Loading factors...</Typography>}
          </Grid>

          <Grid item xs={12} sm={6}>
            <TextField
              fullWidth
              size="small"
              label="Quantity"
              type="number"
              name="quantity"
              value={formData.quantity}
              onChange={handleInputChange}
              required
              inputProps={{ min: 0, step: 'any' }}
            />
          </Grid>

          <Grid item xs={12} sm={6}>
            <FormControl fullWidth size="small">
              <InputLabel id="unit-label">Unit</InputLabel>
              <Select
                labelId="unit-label"
                value={formData.unit}
                label="Unit"
                onChange={handleInputChange}
              >
                {unitOptions.map(u => (
                  <MenuItem key={u} value={u}>{u}</MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>

          <Grid item xs={12} sm={6}>
            <TextField
              fullWidth
              size="small"
              type="date"
              label="Activity Date"
              name="date"
              value={formData.date}
              onChange={handleInputChange}
              required
              InputLabelProps={{ shrink: true }}
            />
          </Grid>

          <Grid item xs={12} sm={6}>
            <TextField
              fullWidth
              size="small"
              label="Facility ID (optional)"
              name="facilityId"
              value={formData.facilityId}
              onChange={handleInputChange}
            />
          </Grid>

          <Grid item xs={12}>
            <TextField
              fullWidth
              size="small"
              multiline
              rows={3}
              label="Description (optional)"
              name="description"
              value={formData.description}
              onChange={handleInputChange}
              placeholder="Enter any additional details about this activity..."
            />
          </Grid>
        </Grid>

        {suggestedFactor && (
          <Paper elevation={1} sx={{ p: 3, mt: 2, mb: 2, backgroundColor: 'info.light' }}>
            <Typography variant="subtitle1" gutterBottom>
              <Info fontSize="inherit" sx={{ mr: 1, verticalAlign: 'middle' }} />
              Suggested Emission Factor
            </Typography>
            <Typography variant="body1">
              <strong>{suggestedFactor.name}</strong> — {suggestedFactor.value} {suggestedFactor.unit} per {suggestedFactor.activityUnit}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Source: {suggestedFactor.source} v{suggestedFactor.sourceVersion}
            </Typography>
          </Paper>
        )}

        {calculationResult && (
          <Paper elevation={2} sx={{ p: 3, mt: 2 }}>
            <Typography variant="h6" gutterBottom>
              <Calculator fontSize="inherit" sx={{ mr: 1, verticalAlign: 'middle', color: 'success.main' }} />
              Calculation Result
            </Typography>
            <Typography variant="h4" color="success.main" gutterBottom>
              {calculationResult.emissions.toFixed(4)} tCO₂e
            </Typography>
            <Typography variant="body2" color="text.secondary" paragraph>
              Activity: {calculationResult.activityValue} {calculationResult.unit} × {calculationResult.emissionFactor} {calculationResult.emissionFactorUnit} = {calculationResult.emissions.toFixed(4)} tCO₂e
            </Typography>
            <Grid container spacing={2} mt={2}>
              <Grid item xs={12} sm={6}>
                <Typography variant="body2" color="text.secondary">Factor</Typography>
                <Typography>{calculationResult.factor.name}</Typography>
              </Grid>
              <Grid item xs={12} sm={6}>
                <Typography variant="body2" color="text.secondary">Source</Typography>
                <Typography>{calculationResult.factor.source} v{calculationResult.factor.sourceVersion}</Typography>
              </Grid>
              <Grid item xs={12} sm={6}>
                <Typography variant="body2" color="text.secondary">Uncertainty</Typography>
                <Typography>{calculationResult.factor.uncertaintyPct ? `${calculationResult.factor.uncertaintyPct}%` : 'Not specified'}</Typography>
              </Grid>
              <Grid item xs={12} sm={6}>
                <Typography variant="body2" color="text.secondary">Quality Rating</Typography>
                <Typography>{calculationResult.factor.qualityRating || 'Not specified'}</Typography>
              </Grid>
              <Grid item xs={12} sm={6}>
                <Typography variant="body2" color="text.secondary">Geography</Typography>
                <Typography>{calculationResult.factor.geography}</Typography>
              </Grid>
            </Grid>
          </Paper>
        )}

        <Alert severity="info" sx={{ mb: 3 }}>
          <AlertTitle>Important</AlertTitle>
          <Typography variant="body2">
            This calculation is performed server-side using tamper-proof emission factors. 
            The result will be logged as an immutable emission activity with full audit trail.
          </Typography>
        </Alert>

        <Box sx={{ display: 'flex', gap: 2, justifyContent: 'center', mt: 3 }}>
          <Button variant="outlined" onClick={onBack} startIcon={<ChevronLeft />} disabled={loading}>
            Back
          </Button>
          <Button 
            variant="contained" 
            onClick={onSubmit} 
            disabled={loading}
            endIcon={<Save />}
            size="large"
          >
            {loading ? 'Saving...' : 'Save & Log Activity'}
          </Button>
        </Box>
      </Box>
    );
  }

  // Step 4: Review
  function ReviewStep({ onBack, onSubmit }) {
    return (
      <Box>
        <Typography variant="h6" gutterBottom>Review & Confirm</Typography>
        <Typography variant="body2" color="text.secondary" paragraph>
          Verify all details before submitting. This will create an immutable emission activity record.
        </Typography>

        <Paper elevation={1} sx={{ p: 3, mb: 2 }}>
          <Typography variant="subtitle1" gutterBottom>Methodology</Typography>
          <Typography>{METHODOLOGIES.find(m => m.code === methodology)?.name}</Typography>
        </Paper>

        <Paper elevation={1} sx={{ p: 3, mb: 2 }}>
          <Typography variant="subtitle1" gutterBottom>Activity</Typography>
          <Typography>{categories.find(c => c.categoryCode === category)?.name}</Typography>
          <Typography variant="body2" color="text.secondary">GHG Scope: {categories.find(c => c.categoryCode === category)?.ghgScope}</Typography>
        </Paper>

        <Paper elevation={1} sx={{ p: 3, mb: 2 }}>
          <Typography variant="subtitle1" gutterBottom>Activity Data</Typography>
          <Grid container spacing={2}>
            <Grid item xs={12} sm={6}>
              <Typography variant="body2" color="text.secondary">Quantity</Typography>
              <Typography>{formData.quantity} {formData.unit}</Typography>
            </Grid>
            <Grid item xs={12} sm={6}>
              <Typography variant="body2" color="text.secondary">Date</Typography>
              <Typography>{formData.date}</Typography>
            </Grid>
            <Grid item xs={12} sm={6}>
              <Typography variant="body2" color="text.secondary">Emission Factor</Typography>
              <Typography>{factors.find(f => f.code === formData.factorCode)?.name}</Typography>
            </Grid>
            <Grid item xs={12} sm={6}>
              <Typography variant="body2" color="text.secondary">Facility</Typography>
              <Typography>{formData.facilityId || 'Not specified'}</Typography>
            </Grid>
          </Grid>
        </Paper>

        {calculationResult && (
          <Paper elevation={2} sx={{ p: 3, mb: 2, border: '1px solid', borderColor: 'success.main' }}>
            <Typography variant="subtitle1" gutterBottom>
              <Calculator fontSize="inherit" sx={{ mr: 1, verticalAlign: 'middle', color: 'success.main' }} />
              Calculated Emissions
            </Typography>
            <Typography variant="h4" color="success.main" gutterBottom>
              {calculationResult.emissions.toFixed(4)} tCO₂e
            </Typography>
          </Paper>
        )}

        <Box sx={{ display: 'flex', gap: 2, justifyContent: 'center', mt: 3 }}>
          <Button variant="outlined" onClick={onBack} startIcon={<ChevronLeft />}>
            Back
          </Button>
          <Button 
            variant="contained" 
            onClick={onSubmit} 
            disabled={loading || !calculationResult}
            endIcon={<Save />}
            size="large"
          >
            {loading ? 'Submitting...' : 'Submit Emission Activity'}
          </Button>
        </Box>
      </Box>
    );
  }

  const stepComponents = [
    <MethodologyStep key="methodology" methodology={methodology} setMethodology={setMethodology} onNext={handleNext} />,
    <CategoryStep key="category" categories={categories} category={category} setCategory={setCategory} methodology={methodology} onBack={handleBack} onNext={handleNext} />,
    <InputStep key="input" formData={formData} handleInputChange={handleInputChange} categories={categories} category={category} factors={factors} suggestedFactor={suggestedFactor} factorLoading={factorLoading} unitOptions={unitOptions} requiredFields={requiredFields} calculationResult={calculationResult} loading={loading} onBack={handleBack} onNext={handleNext} onSubmit={handleSubmit} />,
    <ReviewStep key="review" onBack={handleBack} onSubmit={handleSubmit} />,
  ];

  return (
    <Box sx={{ maxWidth: 900, mx: 'auto', p: 3 }}>
      <Typography variant="h4" gutterBottom component="h1">
        Emission Calculation Wizard
      </Typography>
      <Typography variant="body1" color="text.secondary" paragraph>
        Calculate and log your organization's GHG emissions using verified methodologies and tamper-proof emission factors.
      </Typography>

      <Stepper activeStep={activeStep} alternativeLabel sx={{ mb: 4 }}>
        {STEPS.map((step) => (
          <Step key={step.key}>
            <StepLabel StepIconComponent={({ active, completed }) => (
              <Box
                sx={{
                  width: 40, height: 40, borderRadius: '50%', display: 'flex',
                  alignItems: 'center', justifyContent: 'center',
                  backgroundColor: completed ? 'success.main' : active ? 'primary.main' : 'grey.300',
                  color: completed || active ? 'white' : 'grey.600',
                  fontWeight: 'bold',
                  transition: 'all 0.3s'
                }}
              >
                {completed ? <CheckCircle fontSize="small" /> : STEPS.findIndex(s => s.key === step.key) + 1}
              </Box>
            )}>
              {step.label}
            </StepLabel>
          </Step>
        ))}
      </Stepper>

      {stepComponents[activeStep]}
    </Box>
  );
}
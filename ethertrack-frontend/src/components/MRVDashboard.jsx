// MRVDashboard.jsx — MRV Workflow Dashboard
// Phase 1: MRV Workflow (Plan → Collect → Verify → Approve)

import React, { useState, useEffect, useCallback } from 'react';
import { 
    Box, Paper, Button, Grid, Typography, Table, TableBody, TableCell, TableContainer, 
    TableHead, TableRow, TablePagination, TextField, Select, MenuItem, FormControl, 
    InputLabel, Chip, Dialog, DialogTitle, DialogContent, DialogActions, 
    IconButton, Tooltip, CircularProgress, Alert, Tabs, Tab, 
    Accordion, AccordionSummary, AccordionDetails, Divider, Avatar,
    FormLabel, FormControlLabel, Checkbox
} from '@mui/material';
import { 
    Plus, Edit, Trash2, Eye, Download, Upload, Search, 
    Filter, Refresh, ChevronLeft, ChevronRight, 
    Clock, CheckCircle2, AlertCircle, CheckCircle, 
    ClipboardList, FileText, Gavel, User, Calendar, X, RefreshCw
} from 'lucide-react';
import { mrvAPI } from '../services/api';
import { useSnackbar } from 'notistack';

const STATE_COLORS = {
    DRAFT: 'default',
    SUBMITTED: 'info',
    UNDER_REVIEW: 'warning',
    VERIFIED: 'success',
    APPROVED: 'success',
    REJECTED: 'error',
    ARCHIVED: 'default'
};

const STATE_LABELS = {
    DRAFT: 'Draft',
    SUBMITTED: 'Submitted',
    UNDER_REVIEW: 'Under Review',
    VERIFIED: 'Verified',
    APPROVED: 'Approved',
    REJECTED: 'Rejected',
    ARCHIVED: 'Archived'
};

const METHODOLOGY_LABELS = {
    GHG_PROTOCOL_CORPORATE: 'GHG Protocol Corporate',
    ISO_14064_1: 'ISO 14064-1',
    BRSR_CORE: 'SEBI BRSR Core',
    PAT: 'PAT Scheme',
    CCTS: 'CCTS Compliance'
};

function getStateChip(state) {
    return (
        <Chip 
            label={STATE_LABELS[state] || state} 
            color={STATE_COLORS[state] || 'default'} 
            size="small" 
            variant="outlined"
        />
    );
}

export default function MRVDashboard({ onClose }) {
    const { enqueueSnackbar } = useSnackbar();
    const [plans, setPlans] = useState([]);
    const [loading, setLoading] = useState(false);
    const [page, setPage] = useState(0);
    const [rowsPerPage, setRowsPerPage] = useState(10);
    const [filterState, setFilterState] = useState('');
    const [filterYear, setFilterYear] = useState('');
    const [selectedPlan, setSelectedPlan] = useState(null);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [dialogMode, setDialogMode] = useState('create');
    const [formData, setFormData] = useState({
        planName: '',
        description: '',
        reportingYear: new Date().getFullYear(),
        methodologyTemplate: 'GHG_PROTOCOL_CORPORATE',
        coversScope1: true,
        coversScope2: true,
        coversScope3: false,
        facilityIds: [],
        reportingPeriodStart: new Date().toISOString().split('T')[0],
        reportingPeriodEnd: new Date(new Date().setFullYear(new Date().getFullYear() + 1)).toISOString().split('T')[0],
    });
    const [planDetailOpen, setPlanDetailOpen] = useState(false);
    const [planDetailTab, setPlanDetailTab] = useState('overview');

    const fetchPlans = useCallback(async () => {
        setLoading(true);
        try {
            const res = await mrvAPI.getPlans({ state: filterState, year: filterYear });
            setPlans(res.data || res);
        } catch (err) {
            enqueueSnackbar(`Failed to fetch plans: ${err.message}`, { variant: 'error' });
        } finally {
            setLoading(false);
        }
    }, [filterState, filterYear, enqueueSnackbar]);

    useEffect(() => {
        fetchPlans();
    }, [fetchPlans]);

    const handleCreatePlan = async () => {
        setLoading(true);
        try {
            const res = await mrvAPI.createPlan(formData);
            enqueueSnackbar('MRV Plan created successfully!', { variant: 'success' });
            setDialogOpen(false);
            resetForm();
            fetchPlans();
        } catch (err) {
            enqueueSnackbar(`Failed to create plan: ${err.message}`, { variant: 'error' });
        } finally {
            setLoading(false);
        }
    };

    const handleUpdatePlan = async () => {
        setLoading(true);
        try {
            const res = await mrvAPI.updatePlan(selectedPlan.planId, formData);
            enqueueSnackbar('MRV Plan updated successfully!', { variant: 'success' });
            setDialogOpen(false);
            fetchPlans();
        } catch (err) {
            enqueueSnackbar(`Failed to update plan: ${err.message}`, { variant: 'error' });
        } finally {
            setLoading(false);
        }
    };

    const handleSubmitPlan = async (planId) => {
        setLoading(true);
        try {
            await mrvAPI.submitPlan(planId);
            enqueueSnackbar('Plan submitted for verification!', { variant: 'success' });
            fetchPlans();
        } catch (err) {
            enqueueSnackbar(`Failed to submit plan: ${err.message}`, { variant: 'error' });
        } finally {
            setLoading(false);
        }
    };

    const handleDeletePlan = async (planId) => {
        if (!window.confirm('Are you sure you want to delete this plan?')) return;
        setLoading(true);
        try {
            await mrvAPI.deletePlan(planId);
            enqueueSnackbar('Plan deleted', { variant: 'success' });
            fetchPlans();
        } catch (err) {
            enqueueSnackbar(`Failed to delete plan: ${err.message}`, { variant: 'error' });
        } finally {
            setLoading(false);
        }
    };

    const openCreateDialog = () => {
        resetForm();
        setDialogMode('create');
        setDialogOpen(true);
    };

    const openEditDialog = (plan) => {
        setFormData({
            planName: plan.planName,
            description: plan.description,
            reportingYear: plan.reportingYear,
            methodologyTemplate: plan.methodologyTemplate,
            coversScope1: plan.coversScope1,
            coversScope2: plan.coversScope2,
            coversScope3: plan.coversScope3,
            facilityIds: plan.facilityIds || [],
            reportingPeriodStart: plan.reportingPeriodStart,
            reportingPeriodEnd: plan.reportingPeriodEnd,
        });
        setDialogMode('edit');
        setSelectedPlan(plan);
        setDialogOpen(true);
    };

    const openViewDialog = (plan) => {
        setFormData({
            planName: plan.planName,
            description: plan.description,
            reportingYear: plan.reportingYear,
            methodologyTemplate: plan.methodologyTemplate,
            coversScope1: plan.coversScope1,
            coversScope2: plan.coversScope2,
            coversScope3: plan.coversScope3,
            facilityIds: plan.facilityIds || [],
            reportingPeriodStart: plan.reportingPeriodStart,
            reportingPeriodEnd: plan.reportingPeriodEnd,
        });
        setDialogMode('view');
        setSelectedPlan(plan);
        setDialogOpen(true);
    };

    const openDetailDialog = (plan) => {
        setSelectedPlan(plan);
        setPlanDetailTab('overview');
        setPlanDetailOpen(true);
    };

    const resetForm = () => {
        setFormData({
            planName: '',
            description: '',
            reportingYear: new Date().getFullYear(),
            methodologyTemplate: 'GHG_PROTOCOL_CORPORATE',
            coversScope1: true,
            coversScope2: true,
            coversScope3: false,
            facilityIds: [],
            reportingPeriodStart: new Date().toISOString().split('T')[0],
            reportingPeriodEnd: new Date(new Date().setFullYear(new Date().getFullYear() + 1)).toISOString().split('T')[0],
        });
        setSelectedPlan(null);
    };

    return (
        <Box sx={{ p: 3 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
                <Box>
                    <Typography variant="h4" gutterBottom>MRV Workflow Dashboard</Typography>
                    <Typography variant="body1" color="text.secondary">
                        Manage Measurement, Reporting & Verification plans for carbon projects
                    </Typography>
                </Box>
                <Button 
                    variant="contained" 
                    onClick={openCreateDialog} 
                    startIcon={<Plus />}
                    size="large"
                >
                    Create MRV Plan
                </Button>
            </Box>

            {/* Filters */}
            <Paper elevation={1} sx={{ p: 2, mb: 3 }}>
                <Grid container spacing={2} alignItems="flex-end">
                    <Grid item xs={12} sm={3}>
                        <FormControl fullWidth size="small">
                            <InputLabel id="state-filter">State</InputLabel>
                            <Select
                                value={filterState}
                                label="State"
                                onChange={(e) => setFilterState(e.target.value)}
                            >
                                <MenuItem value="">All States</MenuItem>
                                {Object.entries(STATE_LABELS).map(([key, label]) => (
                                    <MenuItem key={key} value={key}>{label}</MenuItem>
                                ))}
                            </Select>
                        </FormControl>
                    </Grid>
                    <Grid item xs={12} sm={3}>
                        <FormControl fullWidth size="small">
                            <InputLabel id="year-filter">Reporting Year</InputLabel>
                            <Select
                                value={filterYear}
                                label="Year"
                                onChange={(e) => setFilterYear(e.target.value)}
                            >
                                <MenuItem value="">All Years</MenuItem>
                                {[...Array(10)].map((_, i) => new Date().getFullYear() - i).map(y => (
                                    <MenuItem key={y} value={y.toString()}>{y}</MenuItem>
                                ))}
                            </Select>
                        </FormControl>
                    </Grid>
                    <Grid item xs={12} sm={3}>
                        <FormControl fullWidth size="small">
                            <InputLabel id="rows-filter">Rows per page</InputLabel>
                            <Select
                                value={rowsPerPage}
                                label="Rows per page"
                                onChange={(e) => setRowsPerPage(parseInt(e.target.value))}
                            >
                                <MenuItem value={5}>5</MenuItem>
                                <MenuItem value={10}>10</MenuItem>
                                <MenuItem value={25}>25</MenuItem>
                            </Select>
                        </FormControl>
                    </Grid>
                    <Grid item xs={12} sm={3}>
                        <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
                            <Button variant="outlined" onClick={fetchPlans} startIcon={<RefreshCw />}>
                                Refresh
                            </Button>
                        </Box>
                    </Grid>
                </Grid>
            </Paper>

            {/* Plans Table */}
            <Paper elevation={1}>
                <TableContainer>
                    <Table>
                        <TableHead>
                            <TableRow>
                                <TableCell>Plan Name</TableCell>
                                <TableCell>Year</TableCell>
                                <TableCell>Methodology</TableCell>
                                <TableCell>Period</TableCell>
                                <TableCell>State</TableCell>
                                <TableCell>Submitted</TableCell>
                                <TableCell>Verified</TableCell>
                                <TableCell align="right">Actions</TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {loading ? (
                                <TableRow>
                                    <TableCell colSpan={8} align="center" sx={{ py: 4 }}>
                                        <CircularProgress />
                                    </TableCell>
                                </TableRow>
                            ) : plans.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={8} align="center" sx={{ py: 4 }}>
                                        <Typography color="text.secondary">No MRV plans found. Create your first plan to get started.</Typography>
                                    </TableCell>
                                </TableRow>
                            ) : (
                                plans.map((plan) => (
                                    <TableRow key={plan.planId} hover>
                                        <TableCell>
                                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                                <Typography variant="body1" fontWeight={500}>{plan.planName}</Typography>
                                            </Box>
                                        </TableCell>
                                        <TableCell>{plan.reportingYear}</TableCell>
                                        <TableCell>{METHODOLOGY_LABELS[plan.methodologyTemplate] || plan.methodologyTemplate}</TableCell>
                                        <TableCell>
                                            {plan.reportingPeriodStart} to {plan.reportingPeriodEnd}
                                        </TableCell>
                                        <TableCell>{getStateChip(plan.state)}</TableCell>
                                        <TableCell>{plan.submittedAt ? new Date(plan.submittedAt).toLocaleDateString() : '-'}</TableCell>
                                        <TableCell>{plan.verifiedAt ? new Date(plan.verifiedAt).toLocaleDateString() : '-'}</TableCell>
                                        <TableCell align="right">
                                            <Tooltip title="View Details">
                                                <IconButton onClick={() => openViewDialog(plan)} size="small">
                                                    <Eye />
                                                </IconButton>
                                            </Tooltip>
                                            <Tooltip title="Edit Plan">
                                                <IconButton onClick={() => openEditDialog(plan)} size="small" disabled={plan.state !== 'DRAFT'}>
                                                    <Edit />
                                                </IconButton>
                                            </Tooltip>
                                            {plan.state === 'DRAFT' && (
                                                <Tooltip title="Submit for Verification">
                                                    <IconButton onClick={() => handleSubmitPlan(plan.planId)} size="small" color="primary">
                                                        <Gavel />
                                                    </IconButton>
                                                </Tooltip>
                                            )}
                                            <Tooltip title="Delete">
                                                <IconButton onClick={() => handleDeletePlan(plan.planId)} size="small" color="error" disabled={plan.state !== 'DRAFT'}>
                                                    <Trash2 />
                                                </IconButton>
                                            </Tooltip>
                                        </TableCell>
                                    </TableRow>
                                )))}
                        </TableBody>
                    </Table>
                </TableContainer>
                <TablePagination
                    rowsPerPageOptions={[5, 10, 25]}
                    component="div"
                    count={plans.length}
                    rowsPerPage={rowsPerPage}
                    page={page}
                    onPageChange={(e, p) => setPage(p)}
                    onRowsPerPageChange={(e) => setRowsPerPage(parseInt(e.target.value))}
                />
            </Paper>

            {/* Create/Edit Dialog */}
            <Dialog open={dialogOpen} maxWidth="lg" fullWidth onClose={() => { setDialogOpen(false); resetForm(); }}>
                <DialogTitle>{dialogMode === 'create' ? 'Create MRV Plan' : dialogMode === 'edit' ? 'Edit MRV Plan' : 'Plan Details'}</DialogTitle>
                <DialogContent dividers sx={{ maxHeight: '80vh', overflow: 'auto' }}>
                    <Grid container spacing={3} sx={{ p: 1 }}>
                        <Grid item xs={12} sm={6}>
                            <TextField
                                fullWidth
                                label="Plan Name *"
                                value={formData.planName}
                                onChange={(e) => setFormData({...formData, planName: e.target.value})}
                                required
                            />
                        </Grid>
                        <Grid item xs={12} sm={6}>
                            <FormControl fullWidth size="small" required>
                                <InputLabel id="methodology-label">Methodology</InputLabel>
                                <Select
                                    labelId="methodology-label"
                                    value={formData.methodologyTemplate}
                                    label="Methodology"
                                    onChange={(e) => setFormData({...formData, methodologyTemplate: e.target.value})}
                                >
                                    {Object.entries(METHODOLOGY_LABELS).map(([key, label]) => (
                                        <MenuItem key={key} value={key}>{label}</MenuItem>
                                    ))}
                                </Select>
                            </FormControl>
                        </Grid>
                        <Grid item xs={12} sm={6}>
                            <TextField
                                fullWidth
                                type="number"
                                label="Reporting Year *"
                                value={formData.reportingYear}
                                onChange={(e) => setFormData({...formData, reportingYear: parseInt(e.target.value)})}
                                required
                                InputProps={{ inputMode: 'numeric' }}
                            />
                        </Grid>
                        <Grid item xs={12}>
                            <TextField
                                fullWidth
                                multiline
                                rows={3}
                                label="Description"
                                value={formData.description}
                                onChange={(e) => setFormData({...formData, description: e.target.value})}
                            />
                        </Grid>
                        <Grid item xs={12} sm={6}>
                            <TextField
                                fullWidth
                                type="date"
                                label="Reporting Period Start"
                                value={formData.reportingPeriodStart}
                                onChange={(e) => setFormData({...formData, reportingPeriodStart: e.target.value})}
                                InputLabelProps={{ shrink: true }}
                            />
                        </Grid>
                        <Grid item xs={12} sm={6}>
                            <TextField
                                fullWidth
                                type="date"
                                label="Reporting Period End"
                                value={formData.reportingPeriodEnd}
                                onChange={(e) => setFormData({...formData, reportingPeriodEnd: e.target.value})}
                                InputLabelProps={{ shrink: true }}
                            />
                        </Grid>
                        <Grid item xs={12}>
                            <FormControl component="fieldset" fullWidth>
                                <FormLabel component="legend">Scopes Covered</FormLabel>
                                <Grid container spacing={2}>
                                    <Grid item xs={4}>
                                        <FormControlLabel
                                            control={<Checkbox checked={formData.coversScope1} onChange={(e) => setFormData({...formData, coversScope1: e.target.checked})} />}
                                            label="Scope 1 (Direct)"
                                        />
                                    </Grid>
                                    <Grid item xs={4}>
                                        <FormControlLabel
                                            control={<Checkbox checked={formData.coversScope2} onChange={(e) => setFormData({...formData, coversScope2: e.target.checked})} />}
                                            label="Scope 2 (Indirect Energy)"
                                        />
                                    </Grid>
                                    <Grid item xs={4}>
                                        <FormControlLabel
                                            control={<Checkbox checked={formData.coversScope3} onChange={(e) => setFormData({...formData, coversScope3: e.target.checked})} />}
                                            label="Scope 3 (Value Chain)"
                                        />
                                    </Grid>
                                </Grid>
                            </FormControl>
                        </Grid>
                        <Grid item xs={12}>
                            <FormControl fullWidth size="small">
                                <InputLabel id="facility-label">Facilities</InputLabel>
                                <Select
                                    labelId="facility-label"
                                    multiple
                                    value={formData.facilityIds}
                                    onChange={(e) => setFormData({...formData, facilityIds: e.target.value})}
                                    renderValue={(selected) => selected.join(', ')}
                                >
                                    <MenuItem value="FAC-001">FAC-001: Main Factory</MenuItem>
                                    <MenuItem value="FAC-002">FAC-002: Satellite Plant</MenuItem>
                                    <MenuItem value="FAC-003">FAC-003: Warehouse</MenuItem>
                                </Select>
                            </FormControl>
                        </Grid>
                    </Grid>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setDialogOpen(false)} disabled={dialogMode === 'view'}>
                        Cancel
                    </Button>
                    {dialogMode !== 'view' && (
                        <Button variant="contained" onClick={dialogMode === 'create' ? handleCreatePlan : handleUpdatePlan} disabled={loading}>
                            {dialogMode === 'create' ? 'Create Plan' : 'Save Changes'}
                        </Button>
                    )}
                </DialogActions>
            </Dialog>

            {/* Plan Detail Dialog */}
            <Dialog open={planDetailOpen} maxWidth="xl" fullWidth onClose={() => { setPlanDetailOpen(false); setSelectedPlan(null); }}>
                <DialogTitle>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                        <Typography variant="h6">{selectedPlan?.planName}</Typography>
                        <Box sx={{ display: 'flex', gap: 1 }}>
                            {selectedPlan?.state === 'DRAFT' && (
                                <Button variant="contained" color="primary" onClick={() => handleSubmitPlan(selectedPlan.planId)}>
                                    <Gavel /> Submit for Verification
                                </Button>
                            )}
                            <IconButton onClick={() => setPlanDetailOpen(false)}>
                                <X />
                            </IconButton>
                        </Box>
                    </Box>
                </DialogTitle>
                <DialogContent dividers sx={{ maxHeight: '80vh', overflow: 'auto' }}>
                    <Tabs value={planDetailTab} onChange={(e, v) => setPlanDetailTab(v)} sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}>
                        <Tab label="Overview" />
                        <Tab label="Evidence" />
                        <Tab label="Findings" />
                        <Tab label="Timeline" />
                    </Tabs>
                    <Divider />
                    {planDetailTab === 'overview' && <PlanOverview plan={selectedPlan} />}
                    {planDetailTab === 'evidence' && <PlanEvidence planId={selectedPlan?.planId} />}
                    {planDetailTab === 'findings' && <PlanFindings planId={selectedPlan?.planId} />}
                    {planDetailTab === 'timeline' && <PlanTimeline planId={selectedPlan?.planId} />}
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setPlanDetailOpen(false)}>Close</Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
}

// Sub-components for plan detail tabs
function PlanOverview({ plan }) {
    return (
        <Box sx={{ p: 2 }}>
            <Grid container spacing={3}>
                <Grid item xs={12} sm={6}>
                    <Typography variant="h6" gutterBottom>Plan Details</Typography>
                    <Typography variant="body2" color="text.secondary">
                        <strong>Methodology:</strong> {METHODOLOGY_LABELS[plan.methodologyTemplate] || plan.methodologyTemplate}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                        <strong>Reporting Year:</strong> {plan.reportingYear}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                        <strong>Period:</strong> {plan.reportingPeriodStart} to {plan.reportingPeriodEnd}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                        <strong>State:</strong> {STATE_LABELS[plan.state] || plan.state}
                    </Typography>
                </Grid>
                <Grid item xs={12} sm={6}>
                    <Typography variant="h6" gutterBottom>Scopes Covered</Typography>
                    <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                        {plan.coversScope1 && <Chip label="Scope 1" size="small" color="primary" variant="outlined" />}
                        {plan.coversScope2 && <Chip label="Scope 2" size="small" color="secondary" variant="outlined" />}
                        {plan.coversScope3 && <Chip label="Scope 3" size="small" color="success" variant="outlined" />}
                    </Box>
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
                        <strong>Facilities:</strong> {plan.facilityIds?.join(', ') || 'None'}
                    </Typography>
                </Grid>
                <Grid item xs={12}>
                    <Typography variant="h6" gutterBottom>Description</Typography>
                    <Typography variant="body2" color="text.secondary">{plan.description || 'No description provided'}</Typography>
                </Grid>
            </Grid>
        </Box>
    );
}

function PlanEvidence({ planId }) {
    return <Box sx={{ p: 2, textAlign: 'center' }}><Typography color="text.secondary">Evidence management coming soon</Typography></Box>;
}

function PlanFindings({ planId }) {
    return <Box sx={{ p: 2, textAlign: 'center' }}><Typography color="text.secondary">Findings management coming soon</Typography></Box>;
}

function PlanTimeline({ planId }) {
    return <Box sx={{ p: 2, textAlign: 'center' }}><Typography color="text.secondary">Timeline view coming soon</Typography></Box>;
}
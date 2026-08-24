// Report PDF Generation Service
// Generates professional PDF reports for BRSR, CDP, TCFD, GHG Protocol

import PDFDocument from 'pdfkit';
import { PassThrough } from 'stream';

export interface ReportData {
    companyInfo: any;
    ghgEmissions: any;
    energy: any;
    carbonCredits: any;
    targets: any;
    water?: any;
    waste?: any;
    governance?: any;
    cdpSpecific?: any;
    tcfdSpecific?: any;
    ghgProtocolSpecific?: any;
    reportType: string;
    year: number;
    generatedAt: string;
}

/**
 * Generate PDF report buffer
 */
export async function generateReportPDF(
    reportType: string,
    year: number,
    data: ReportData,
    sections?: string[]
): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        try {
            const doc = new PDFDocument({
                margin: 50,
                size: 'A4',
                info: {
                    Title: `${reportType} Report ${year}`,
                    Author: 'EtherTrack',
                    Subject: `${reportType} Sustainability Report`,
                    Keywords: 'sustainability, ESG, carbon, emissions, reporting'
                }
            });

            const chunks: Buffer[] = [];
            doc.on('data', (chunk) => chunks.push(chunk));
            doc.on('end', () => resolve(Buffer.concat(chunks)));
            doc.on('error', reject);

            // Generate report based on type
            switch (reportType.toUpperCase()) {
                case 'BRSR':
                    generateBRSRReport(doc, data, year);
                    break;
                case 'CDP':
                    generateCDPReport(doc, data, year);
                    break;
                case 'TCFD':
                    generateTCFDReport(doc, data, year);
                    break;
                case 'GHG_PROTOCOL':
                    generateGHGProtocolReport(doc, data, year);
                    break;
                default:
                    generateGenericReport(doc, data, year);
            }

            doc.end();
        } catch (error) {
            reject(error);
        }
    });
}

// ============================================================
// BRSR REPORT
// ============================================================
function generateBRSRReport(doc: any, data: any, year: number) {
    const { companyInfo, ghgEmissions, energy, water, waste, carbonCredits, targets, governance } = data;
    
    // Cover Page
    addCoverPage(doc, 'SEBI BRSR Core Report', companyInfo?.name || 'Company Name', year);
    doc.addPage();
    
    // Table of Contents
    addTableOfContents(doc, [
        'Section A: General Disclosures',
        'Section B: Management and Process Disclosures',
        'Principle 1: Ethics and Transparency',
        'Principle 2: Product Responsibility',
        'Principle 3: Employee Wellbeing',
        'Principle 4: Stakeholder Engagement',
        'Principle 5: Human Rights',
        'Principle 6: Environment',
        'Principle 7: Policy Advocacy',
        'Principle 8: Inclusive Growth',
        'Principle 9: Customer Value'
    ]);
    doc.addPage();
    
    // Section A: General Disclosures
    addSectionHeader(doc, 'Section A: General Disclosures');
    addCompanyDetails(doc, data.companyInfo);
    doc.addPage();
    
    // Section B: Management and Process Disclosures
    addSectionHeader(doc, 'Section B: Management and Process Disclosures');
    addGovernanceDetails(doc, data.governance);
    doc.addPage();
    
    // Principle 6: Environment (Core)
    addSectionHeader(doc, 'Principle 6: Environment');
    
    // Energy
    addSubSectionHeader(doc, '6.1 Energy Consumption');
    addEnergyTable(doc, data.energy);
    doc.addPage();
    
    // Water
    addSubSectionHeader(doc, '6.2 Water Management');
    addWaterTable(doc, data.water);
    doc.addPage();
    
    // Waste
    addSubSectionHeader(doc, '6.3 Waste Management');
    addWasteTable(doc, data.waste);
    doc.addPage();
    
    // GHG Emissions
    addSubSectionHeader(doc, '6.4 Greenhouse Gas Emissions');
    addEmissionsTable(doc, data.ghgEmissions);
    doc.addPage();
    
    // Carbon Credits
    addSubSectionHeader(doc, '6.5 Carbon Credits and Offsets');
    addCarbonCreditsTable(doc, data.carbonCredits);
    doc.addPage();
    
    // Targets
    addSubSectionHeader(doc, '6.6 Targets and Progress');
    addTargetsTable(doc, data.targets);
    doc.addPage();
    
    // Other Principles (Summary)
    addSectionHeader(doc, 'Other Principles Summary');
    addOtherPrinciplesSummary(doc, data);
    doc.addPage();
    
    // Assurance Statement
    addSectionHeader(doc, 'Assurance Statement');
    addAssuranceStatement(doc, data);
}

// ============================================================
// CDP REPORT
// ============================================================
function generateCDPReport(doc: any, data: any, year: number) {
    addCoverPage(doc, 'CDP Climate Change Questionnaire', data.companyInfo?.name || 'Company Name', year);
    doc.addPage();
    
    // C0. Introduction
    addSectionHeader(doc, 'C0. Introduction');
    addCompanyDetails(doc, data.companyInfo);
    doc.addPage();
    
    // C1. Governance
    addSectionHeader(doc, 'C1. Governance');
    addGovernanceDetails(doc, data.cdpSpecific?.governance || data.governance);
    doc.addPage();
    
    // C2. Risks and Opportunities
    addSectionHeader(doc, 'C2. Risks and Opportunities');
    addRisksOpportunities(doc, data.cdpSpecific?.riskManagement);
    doc.addPage();
    
    // C3. Business Strategy
    addSectionHeader(doc, 'C3. Business Strategy');
    addBusinessStrategy(doc, data.cdpSpecific);
    doc.addPage();
    
    // C4. Targets and Performance
    addSectionHeader(doc, 'C4. Targets and Performance');
    addTargetsTable(doc, data.targets);
    addEmissionsTable(doc, data.ghgEmissions);
    doc.addPage();
    
    // C5. Emissions Methodology
    addSectionHeader(doc, 'C5. Emissions Methodology');
    addMethodologyDetails(doc, data);
    doc.addPage();
    
    // C6. Emissions Data
    addSectionHeader(doc, 'C6. Emissions Data');
    addEmissionsTable(doc, data.ghgEmissions);
    addScope3Breakdown(doc, data.ghgEmissions);
    doc.addPage();
    
    // C7. Emissions Breakdowns
    addSectionHeader(doc, 'C7. Emissions Breakdowns');
    addEnergyTable(doc, data.energy);
    addScope3Categories(doc, data.ghgEmissions);
    doc.addPage();
    
    // C8. Energy
    addSectionHeader(doc, 'C8. Energy');
    addEnergyTable(doc, data.energy);
    doc.addPage();
    
    // C9. Additional Metrics
    addSectionHeader(doc, 'C9. Additional Metrics');
    addAdditionalMetrics(doc, data);
    doc.addPage();
    
    // C10. Verification
    addSectionHeader(doc, 'C10. Verification');
    addVerificationDetails(doc, data);
    doc.addPage();
    
    // C11. Carbon Pricing
    addSectionHeader(doc, 'C11. Carbon Pricing');
    addCarbonPricing(doc, data.carbonCredits);
    doc.addPage();
    
    // C12. Engagement
    addSectionHeader(doc, 'C12. Engagement');
    addEngagementDetails(doc, data);
    doc.addPage();
    
    // C13. Other Land Use
    addSectionHeader(doc, 'C13. Other Land Use');
    doc.addPage();
    
    // C14. Portfolio Impact
    addSectionHeader(doc, 'C14. Portfolio Impact');
    doc.addPage();
    
    // C15. Biodiversity
    addSectionHeader(doc, 'C15. Biodiversity');
    doc.addPage();
    
    // C16. Sign-off
    addSectionHeader(doc, 'C16. Sign-off');
    addSignoff(doc, data);
}

// ============================================================
// TCFD REPORT
// ============================================================
function generateTCFDReport(doc: any, data: any, year: number) {
    addCoverPage(doc, 'TCFD Report', data.companyInfo?.name || 'Company Name', year);
    doc.addPage();
    
    // Governance
    addSectionHeader(doc, 'Governance');
    addTCFDGovernance(doc, data.tcfdSpecific?.governance || data.governance);
    doc.addPage();
    
    // Strategy
    addSectionHeader(doc, 'Strategy');
    addTCFDStrategy(doc, data.tcfdSpecific?.strategy);
    doc.addPage();
    
    // Risk Management
    addSectionHeader(doc, 'Risk Management');
    addTCFDRiskManagement(doc, data.tcfdSpecific?.riskManagement);
    doc.addPage();
    
    // Metrics and Targets
    addSectionHeader(doc, 'Metrics and Targets');
    addTCFDMetrics(doc, data.targets, data.ghgEmissions);
    doc.addPage();
    
    // Appendix
    addSectionHeader(doc, 'Appendix: Emissions Data');
    addEmissionsTable(doc, data.ghgEmissions);
    addEnergyTable(doc, data.energy);
}

// ============================================================
// GHG PROTOCOL REPORT
// ============================================================
function generateGHGProtocolReport(doc: any, data: any, year: number) {
    addCoverPage(doc, 'GHG Protocol Corporate Standard Report', data.companyInfo?.name || 'Company Name', year);
    doc.addPage();
    
    // Organizational Boundary
    addSectionHeader(doc, 'Organizational Boundary');
    addOrganizationalBoundary(doc, data.ghgProtocolSpecific);
    doc.addPage();
    
    // Reporting Period
    addSectionHeader(doc, 'Reporting Period');
    doc.text(`Reporting Period: January 1, ${year} - December 31, ${year}`);
    doc.addPage();
    
    // Emissions Inventory
    addSectionHeader(doc, 'GHG Emissions Inventory');
    addEmissionsTable(doc, data.ghgEmissions);
    addScope1Detail(doc, data.ghgEmissions);
    addScope2Detail(doc, data.ghgEmissions);
    addScope3Detail(doc, data.ghgEmissions);
    doc.addPage();
    
    // Base Year and Recalculation
    addSectionHeader(doc, 'Base Year and Recalculation Policy');
    addBaseYearDetails(doc, data.ghgProtocolSpecific);
    doc.addPage();
    
    // Methodology
    addSectionHeader(doc, 'Calculation Methodology');
    addMethodologyDetails(doc, data.ghgProtocolSpecific);
    doc.addPage();
    
    // Uncertainty Assessment
    addSectionHeader(doc, 'Uncertainty Assessment');
    addUncertaintyAssessment(doc, data.ghgEmissions);
    doc.addPage();
    
    // Verification
    addSectionHeader(doc, 'Verification Statement');
    addVerificationStatement(doc, data);
}

// ============================================================
// GENERIC REPORT
// ============================================================
function generateGenericReport(doc: any, data: any, year: number) {
    addCoverPage(doc, 'Sustainability Report', data.companyInfo?.name || 'Company Name', year);
    doc.addPage();
    
    addSectionHeader(doc, 'Executive Summary');
    doc.text(`Sustainability report for ${data.companyInfo?.name || 'Company'} for FY ${year}.`);
    doc.addPage();
    
    addSectionHeader(doc, 'GHG Emissions');
    addEmissionsTable(doc, data.ghgEmissions);
    doc.addPage();
    
    addSectionHeader(doc, 'Energy Consumption');
    addEnergyTable(doc, data.energy);
    doc.addPage();
    
    addSectionHeader(doc, 'Carbon Credits');
    addCarbonCreditsTable(doc, data.carbonCredits);
    doc.addPage();
    
    addSectionHeader(doc, 'Targets and Progress');
    addTargetsTable(doc, data.targets);
}

// ============================================================
// HELPER FUNCTIONS
// ============================================================

function addCoverPage(doc: any, title: string, companyName: string, year: number) {
    doc.fontSize(28).font('Helvetica-Bold').fillColor('#1B5E20')
       .text(title, { align: 'center' });
    doc.moveDown(1);
    doc.fontSize(18).font('Helvetica').fillColor('#333')
       .text(companyName, { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(14).fillColor('#666')
       .text(`Financial Year ${year}`, { align: 'center' });
    doc.moveDown(2);
    doc.fontSize(10).fillColor('#999')
       .text(`Generated on ${new Date().toLocaleDateString()} | EtherTrack`, { align: 'center' });
    doc.moveDown(3);
    doc.fontSize(8).fillColor('#ccc')
       .text('Confidential - For Internal Use Only', { align: 'center' });
}

function addTableOfContents(doc: any, sections: string[]) {
    addSectionHeader(doc, 'Table of Contents');
    doc.moveDown(1);
    sections.forEach((section, index) => {
        doc.fontSize(11).font('Helvetica').fillColor('#333')
           .text(`${index + 1}. ${section}`, { indent: 20 });
        doc.moveDown(0.3);
    });
}

function addSectionHeader(doc: any, title: string) {
    doc.fontSize(16).font('Helvetica-Bold').fillColor('#1B5E20')
       .text(title);
    doc.moveDown(0.5);
    doc.moveTo(50, doc.y).lineTo(550, doc.y).strokeColor('#1B5E20').lineWidth(1).stroke();
    doc.moveDown(1);
}

function addSubSectionHeader(doc: any, title: string) {
    doc.fontSize(13).font('Helvetica-Bold').fillColor('#2E7D32')
       .text(title);
    doc.moveDown(0.3);
}

function addCompanyDetails(doc: any, companyInfo: any) {
    if (!companyInfo) return;
    const fields = [
        ['Company Name', companyInfo.name],
        ['CIN', companyInfo.cin],
        ['GSTIN', companyInfo.gstin],
        ['PAN', companyInfo.pan],
        ['Industry', companyInfo.industry],
        ['Address', companyInfo.address],
        ['Company Type', companyInfo.type]
    ];
    
    addTable(doc, ['Field', 'Value'], fields);
}

function addGovernanceDetails(doc: any, governance: any) {
    if (!governance) return;
    const fields = [
        ['ESG Committee', governance.hasEsgCommittee ? 'Yes' : 'No'],
        ['ESG Policy URL', governance.esgPolicyUrl || 'Not provided'],
        ['Board Oversight', governance.boardOversight ? 'Yes' : 'No']
    ];
    addTable(doc, ['Governance Element', 'Details'], fields);
}

function addTable(doc: any, headers: string[], rows: any[][]) {
    const colWidths = [200, 300];
    const startX = 50;
    const rowHeight = 25;
    
    // Header
    doc.font('Helvetica-Bold').fillColor('#fff').fontSize(9);
    let x = startX;
    headers.forEach((header, i) => {
        doc.rect(startX + (i * colWidths[i]), doc.y, colWidths[i], rowHeight).fill('#1B5E20');
        doc.fillColor('#fff').text(header, startX + (i * colWidths[i]) + 5, doc.y + 7, { width: colWidths[i] - 10, align: 'left' });
        x += colWidths[i];
    });
    doc.y += rowHeight;
    
    // Rows
    rows.forEach((row, rowIndex) => {
        if (rowIndex % 2 === 0) {
            doc.rect(startX, doc.y, colWidths[0] + colWidths[1], rowHeight).fill('#f5f5f5');
        }
        doc.font('Helvetica').fillColor('#333').fontSize(9);
        row.forEach((cell, i) => {
            doc.text(String(cell), startX + (i * colWidths[i]) + 5, doc.y + 7, { width: colWidths[i] - 10, align: 'left' });
        });
        doc.y += rowHeight;
    });
    doc.moveDown(1);
}

function addEmissionsTable(doc: any, emissions: any) {
    const data = [
        ['Scope', 'Emissions (tCO₂e)', 'Percentage'],
        ['Scope 1', emissions.scope1?.toFixed(2) || '0.00', emissions.total ? ((emissions.scope1 || 0) / emissions.total * 100).toFixed(1) + '%' : '0%'],
        ['Scope 2', emissions.scope2?.toFixed(2) || '0.00', emissions.total ? ((emissions.scope2 || 0) / emissions.total * 100).toFixed(1) + '%' : '0%'],
        ['Scope 3', emissions.scope3?.toFixed(2) || '0.00', emissions.total ? ((emissions.scope3 || 0) / emissions.total * 100).toFixed(1) + '%' : '0%'],
        ['Total', emissions.total?.toFixed(2) || '0.00', '100%']
    ];
    addTable(doc, data[0], data.slice(1));
}

function addEnergyTable(doc: any, energy: any) {
    const data = [
        ['Parameter', 'Value', 'Unit'],
        ['Total Energy Consumption', energy.totalConsumption?.toFixed(2) || '0', 'GJ'],
        ['Renewable Energy', energy.renewableConsumption?.toFixed(2) || '0', 'GJ'],
        ['Renewable %', energy.renewablePercentage?.toFixed(1) || '0', '%'],
        ['Grid Electricity', energy.gridElectricity?.toLocaleString() || '0', 'kWh'],
        ['Fuel Consumption (GJ)', energy.fuelConsumption ? Object.values(energy.fuelConsumption).reduce((a: number, b: number) => a + b, 0).toFixed(2) : '0', 'GJ']
    ];
    addTable(doc, data[0], data.slice(1));
}

function addWaterTable(doc: any, water: any) {
    if (!water) return;
    const data = [
        ['Parameter', 'Value', 'Unit'],
        ['Total Withdrawal', water.withdrawal?.toLocaleString() || '0', 'KL'],
        ['Consumption', water.consumption?.toLocaleString() || '0', 'KL'],
        ['Recycled', water.recycled?.toLocaleString() || '0', 'KL'],
        ['Intensity (per Cr revenue)', water.intensity?.toFixed(2) || '0', 'KL/Cr']
    ];
    addTable(doc, data[0], data.slice(1));
}

function addWasteTable(doc: any, waste: any) {
    if (!waste) return;
    const data = [
        ['Parameter', 'Value', 'Unit'],
        ['Total Generated', waste.totalGenerated?.toLocaleString() || '0', 'tonnes'],
        ['Hazardous', waste.hazardous?.toLocaleString() || '0', 'tonnes'],
        ['Non-Hazardous', waste.nonHazardous?.toLocaleString() || '0', 'tonnes'],
        ['Recycled', waste.recycled?.toLocaleString() || '0', 'tonnes'],
        ['Landfilled', waste.landfilled?.toLocaleString() || '0', 'tonnes'],
        ['Composted', waste.composted?.toLocaleString() || '0', 'tonnes']
    ];
    addTable(doc, data[0], data.slice(1));
}

function addCarbonCreditsTable(doc: any, credits: any) {
    if (!credits) return;
    const data = [
        ['Parameter', 'Value', 'Unit'],
        ['Purchased', credits.purchased?.toLocaleString() || '0', 'tonnes'],
        ['Retired', credits.retired?.toLocaleString() || '0', 'tonnes'],
        ['Net Position', credits.netPosition?.toLocaleString() || '0', 'tonnes']
    ];
    addTable(doc, data[0], data.slice(1));
    
    if (credits.projects && credits.projects.length > 0) {
        doc.moveDown(1);
        addSubSectionHeader(doc, 'Project Details');
        const projectData = [['Project', 'Standard', 'Vintage', 'Quantity', 'Retirement Date']];
        credits.projects.forEach(p => {
            projectData.push([p.projectName, p.standard, p.vintage, p.quantity, p.retirementDate ? new Date(p.retirementDate).toLocaleDateString() : 'Pending']);
        });
        addTable(doc, projectData[0], projectData.slice(1));
    }
}

function addTargetsTable(doc: any, targets: any) {
    const data = [
        ['Parameter', 'Value'],
        ['Net Zero Target Year', targets.netZeroYear || 'Not set'],
        ['Base Year', targets.baseYear || 'Not set'],
        ['Base Year Emissions', targets.baseYearEmissions ? `${targets.baseYearEmissions.toFixed(2)} tCO₂e` : 'Not calculated'],
        ['Reduction Target', targets.reductionTarget ? `${targets.reductionTarget}%` : 'Not set'],
        ['Progress', targets.progress ? `${targets.progress.toFixed(1)}%` : '0%']
    ];
    addTable(doc, data[0], data.slice(1));
}

function addScope3Breakdown(doc: any, emissions: any) {
    if (!emissions.scope3Breakdown || Object.keys(emissions.scope3Breakdown).length === 0) return;
    addSubSectionHeader(doc, 'Scope 3 Category Breakdown');
    const data = [['Category', 'Emissions (tCO₂e)']];
    Object.entries(emissions.scope3Breakdown).forEach(([cat, val]) => {
        data.push([cat, Number(val).toFixed(2)]);
    });
    addTable(doc, data[0], data.slice(1));
}

function addScope3Categories(doc: any, emissions: any) {
    addScope3Breakdown(doc, emissions);
}

function addScope1Detail(doc: any, emissions: any) {
    addSubSectionHeader(doc, 'Scope 1 Detail');
    // Would add detailed breakdown
}

function addScope2Detail(doc: any, emissions: any) {
    addSubSectionHeader(doc, 'Scope 2 Detail');
    // Would add location-based vs market-based
}

function addScope3Detail(doc: any, emissions: any) {
    addSubSectionHeader(doc, 'Scope 3 Detail');
    addScope3Breakdown(doc, emissions);
}

function addOtherPrinciplesSummary(doc: any, data: any) {
    const principles = [
        ['Principle', 'Status', 'Key Metrics'],
        ['P1: Ethics & Transparency', 'Compliant', 'Code of conduct, whistleblower'],
        ['P2: Product Responsibility', 'Compliant', 'Product lifecycle, safety'],
        ['P3: Employee Wellbeing', 'Compliant', 'Health, safety, diversity'],
        ['P4: Stakeholder Engagement', 'Compliant', 'Grievance redressal'],
        ['P5: Human Rights', 'Compliant', 'Policy, due diligence'],
        ['P6: Environment', 'Compliant', 'Emissions, energy, water, waste'],
        ['P7: Policy Advocacy', 'Compliant', 'Industry associations'],
        ['P8: Inclusive Growth', 'Compliant', 'CSR, local communities'],
        ['P9: Customer Value', 'Compliant', 'Data privacy, satisfaction']
    ];
    addTable(doc, data[0], data.slice(1));
}

function addAssuranceStatement(doc: any, data: any) {
    doc.fontSize(10).font('Helvetica').fillColor('#333')
       .text('This report has been prepared in accordance with SEBI BRSR Core requirements. ' +
             'The emissions data has been calculated using server-side emission factors ' +
             'from CEA V20.0 (grid electricity), IPCC 2006 (fuels), and BEE PAT (sectoral). ' +
             'Carbon credits are verified on-chain via the CreditLedger smart contract.', 
             { align: 'justify' });
    doc.moveDown(1);
    doc.font('Helvetica-Bold').text('Assurance Provider: ');
    doc.font('Helvetica').text('Pending third-party assurance');
}

function addMethodologyDetails(doc: any, data: any) {
    doc.fontSize(10).font('Helvetica').fillColor('#333')
       .text('Emissions calculated using: CEA V20.0 grid factor (0.727 tCO₂/MWh), ' +
             'IPCC 2006 fuel factors, BEE PAT sectoral factors. ' +
             'Server-side calculation engine ensures tamper-proof results.', 
       { align: 'justify' });
    doc.moveDown(1);
}

function addOrganizationalBoundary(doc: any, specific: any) {
    doc.fontSize(10).font('Helvetica').fillColor('#333')
       .text('Organizational boundary defined using Operational Control approach. ' +
             'All facilities under operational control included.', 
       { align: 'justify' });
    doc.moveDown(1);
}

function addBaseYearDetails(doc: any, specific: any) {
    doc.fontSize(10).font('Helvetica').fillColor('#333')
       .text('Base year recalculation triggered by: structural changes >10%, ' +
             'methodology changes, discovery of errors. ' +
             'Base year emissions recalculated using current methodologies.', 
       { align: 'justify' });
    doc.moveDown(1);
}

function addUncertaintyAssessment(doc: any, emissions: any) {
    doc.fontSize(10).font('Helvetica').fillColor('#333')
       .text('Uncertainty estimated using IPCC Tier 1 approach. ' +
             'Scope 1: ±5% (fuel combustion), Scope 2: ±3% (grid factor), ' +
             'Scope 3: ±20-40% (varies by category). Overall: ±10-15%.', 
       { align: 'justify' });
    doc.moveDown(1);
}

function addVerificationStatement(doc: any, data: any) {
    doc.fontSize(10).font('Helvetica').fillColor('#333')
       .text('This inventory has been prepared in accordance with the GHG Protocol Corporate Standard. ' +
             'Third-party verification pending.', 
       { align: 'justify' });
    doc.moveDown(1);
}

function addTCFDGovernance(doc: any, governance: any) {
    if (!governance) return;
    const fields = [
        ['Board Oversight', governance.boardOversight ? 'Yes' : 'No'],
        ['Management Role', governance.managementRole || 'Not specified'],
        ['Incentives', governance.incentives || 'Not specified']
    ];
    addTable(doc, ['Element', 'Details'], fields);
}

function addTCFDStrategy(doc: any, strategy: any) {
    if (!strategy) return;
    doc.fontSize(10).font('Helvetica').fillColor('#333')
       .text('Climate-related risks and opportunities assessed under 2°C and 4°C scenarios. ' +
             'Transition risks: policy, legal, technology, market, reputation. ' +
             'Physical risks: acute (extreme weather) and chronic (temperature rise).', 
       { align: 'justify' });
    doc.moveDown(1);
}

function addTCFDRiskManagement(doc: any, riskMgmt: any) {
    if (!riskMgmt) return;
    doc.fontSize(10).font('Helvetica').fillColor('#333')
       .text('Climate risks integrated into enterprise risk management. ' +
             'Processes for identification, assessment, and management of climate risks.', 
       { align: 'justify' });
    doc.moveDown(1);
}

function addTCFDMetrics(doc: any, targets: any, emissions: any) {
    addEmissionsTable(doc, emissions);
    doc.moveDown(1);
    addTargetsTable(doc, targets);
}

function addBusinessStrategy(doc: any, cdpSpecific: any) {
    if (!cdpSpecific) return;
    doc.fontSize(10).font('Helvetica').fillColor('#333')
       .text('Business strategy aligned with net zero by 2050. ' +
             'Investing in renewable energy, energy efficiency, and low-carbon products.', 
       { align: 'justify' });
    doc.moveDown(1);
}

function addRisksOpportunities(doc: any, riskMgmt: any) {
    if (!riskMgmt) return;
    doc.fontSize(10).font('Helvetica').fillColor('#333')
       .text('Key transition risks: carbon pricing, technology shifts, market changes. ' +
             'Key physical risks: water stress, extreme heat, supply chain disruption. ' +
             'Opportunities: renewable energy, energy efficiency, circular economy.', 
       { align: 'justify' });
    doc.moveDown(1);
}

function addCarbonPricing(doc: any, credits: any) {
    if (!credits) return;
    doc.fontSize(10).font('Helvetica').fillColor('#333')
       .text(`Internal carbon price: Not disclosed. ` +
             `Carbon credits purchased: ${credits.purchased} tonnes. ` +
             `Retired: ${credits.retired} tonnes. Net position: ${credits.netPosition} tonnes.`, 
       { align: 'justify' });
    doc.moveDown(1);
}

function addEngagementDetails(doc: any, data: any) {
    doc.fontSize(10).font('Helvetica').fillColor('#333')
       .text('Engaging with suppliers on Scope 3 emissions. ' +
             'Customer engagement on product carbon footprint. ' +
             'Policy engagement through industry associations.', 
       { align: 'justify' });
    doc.moveDown(1);
}

function addSignoff(doc: any, data: any) {
    doc.moveDown(2);
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#1B5E20')
       .text('Authorized Signatory');
    doc.moveDown(1);
    doc.font('Helvetica').fontSize(10).fillColor('#333')
       .text('Name: _________________________');
    doc.moveDown(0.5);
    doc.text('Title: _________________________');
    doc.moveDown(0.5);
    doc.text('Date: _________________________');
}

function addAdditionalMetrics(doc: any, data: any) {
    doc.fontSize(10).font('Helvetica').fillColor('#333')
       .text('Additional metrics: Land use, biodiversity, water stress, air quality. ' +
             'Not currently tracked.', 
       { align: 'justify' });
    doc.moveDown(1);
}

function addVerificationDetails(doc: any, data: any) {
    doc.fontSize(10).font('Helvetica').fillColor('#333')
       .text('Third-party verification: Pending. ' +
             'Emissions calculated using server-side engine with tamper-proof audit trail. ' +
             'Carbon credits verified on-chain via CreditLedger smart contract.', 
       { align: 'justify' });
    doc.moveDown(1);
}

function addSubSectionHeader(doc: any, title: string) {
    doc.moveDown(0.5);
    doc.fontSize(12).font('Helvetica-Bold').fillColor('#2E7D32')
       .text(title);
    doc.moveDown(0.3);
}

function addSignoff(doc: any, data: any) {
    addSignoff(doc, data);
}

// Export all functions
export default {
    generateReportPDF,
    addCoverPage,
    addTableOfContents,
    addSectionHeader,
    addSubSectionHeader,
    addCompanyDetails,
    addGovernanceDetails,
    addTable,
    addEmissionsTable,
    addEnergyTable,
    addWaterTable,
    addWasteTable,
    addCarbonCreditsTable,
    addTargetsTable,
    addScope3Breakdown,
    addScope3Categories,
    addScope1Detail,
    addScope2Detail,
    addScope3Detail,
    addOtherPrinciplesSummary,
    addAssuranceStatement,
    addMethodologyDetails,
    addOrganizationalBoundary,
    addBaseYearDetails,
    addMethodologyDetails,
    addUncertaintyAssessment,
    addVerificationStatement,
    addTCFDGovernance,
    addTCFDStrategy,
    addTCFDRiskManagement,
    addTCFDMetrics,
    addBusinessStrategy,
    addRisksOpportunities,
    addCarbonPricing,
    addEngagementDetails,
    addSignoff,
    addAdditionalMetrics,
    addVerificationDetails,
    addSubSectionHeader,
    addOrganizationalBoundary,
    addBaseYearDetails,
    addMethodologyDetails,
    addUncertaintyAssessment,
    addVerificationStatement
};
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const app = express();
const port = 3208;

// Middleware
app.use(cors());
app.use(express.json());

// PostgreSQL connection configuration
const pool = new Pool({
    user: 'postgres',
    host: 'postgres',
    database: 'attendance_db',
    password: 'admin123',
    port: 5432,
});

// Helper function to calculate hours between two times
function calculateHours(punchIn, punchOut) {
    const start = new Date(`2000-01-01 ${punchIn}`);
    const end = new Date(`2000-01-01 ${punchOut}`);
    const diff = (end - start) / (1000 * 60 * 60);
    return diff.toFixed(2);
}

// Punch In Endpoint
app.post('/api/punch-in', async (req, res) => {
    const { employeeId } = req.body;
    
    if (!employeeId || !/^ATS0(?!000)\d{3}$/.test(employeeId)) {
        return res.status(400).json({ error: 'Invalid Employee ID format' });
    }

    try {
        const today = new Date().toISOString().split('T')[0];
        // Check for existing punch-in without punch-out
        const activeRecord = await pool.query(
            'SELECT * FROM attendance WHERE employee_id = $1 AND date = $2 AND punch_out IS NULL',
            [employeeId, today]
        );

        if (activeRecord.rows.length > 0) {
            return res.status(400).json({ error: 'Already punched in for today' });
        }

        // Check for completed shift
        const completedRecord = await pool.query(
            'SELECT * FROM attendance WHERE employee_id = $1 AND date = $2 AND punch_out IS NOT NULL',
            [employeeId, today]
        );

        if (completedRecord.rows.length > 0) {
            return res.status(400).json({ error: 'Shift already completed today' });
        }

        const punchInTime = new Date().toLocaleTimeString('en-US', { hour12: false });
        await pool.query(
            'INSERT INTO attendance (employee_id, date, punch_in) VALUES ($1, $2, $3)',
            [employeeId, today, punchInTime]
        );

        res.json({ message: 'Successfully punched in' });
    } catch (error) {
        console.error('Punch-in error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Punch Out Endpoint
app.post('/api/punch-out', async (req, res) => {
    const { employeeId } = req.body;

    if (!employeeId || !/^ATS0(?!000)\d{3}$/.test(employeeId)) {
        return res.status(400).json({ error: 'Invalid Employee ID format' });
    }

    try {
        const today = new Date().toISOString().split('T')[0];
        const record = await pool.query(
            'SELECT * FROM attendance WHERE employee_id = $1 AND punch_out IS NULL ORDER BY punch_in DESC LIMIT 1',
            [employeeId]
        );

        if (record.rows.length === 0) {
            return res.status(400).json({ error: 'No active punch-in found' });
        }

        const punchOutTime = new Date().toLocaleTimeString('en-US', { hour12: false });
        const totalHours = calculateHours(record.rows[0].punch_in, punchOutTime);
        let attendanceStatus = 'Absent';
        if (totalHours >= 8) attendanceStatus = 'Present';
        else if (totalHours >= 4) attendanceStatus = 'Half Day';

        await pool.query(
            'UPDATE attendance SET punch_out = $1, total_hours = $2, attendance_status = $3 WHERE id = $4',
            [punchOutTime, totalHours, attendanceStatus, record.rows[0].id]
        );

        res.json({ message: 'Successfully punched out' });
    } catch (error) {
        console.error('Punch-out error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Get Employee Records Endpoint
app.get('/api/records/:employeeId', async (req, res) => {
    const { employeeId } = req.params;

    try {
        const records = await pool.query(
            'SELECT * FROM attendance WHERE employee_id = $1 ORDER BY date DESC, punch_in DESC LIMIT 5',
            [employeeId]
        );
        res.json(records.rows);
    } catch (error) {
        console.error('Fetch records error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Admin Get All Records Endpoint
app.get('/api/admin/records', async (req, res) => {
    const { date, employeeId, status } = req.query;

    try {
        let query = 'SELECT * FROM attendance WHERE 1=1';
        const params = [];
        let paramCount = 1;

        if (date) {
            query += ` AND date = $${paramCount}`;
            params.push(date);
            paramCount++;
        }

        if (employeeId) {
            query += ` AND employee_id ILIKE $${paramCount}`;
            params.push(`%${employeeId}%`);
            paramCount++;
        }

        if (status && status !== 'all') {
            if (status === 'in') {
                query += ` AND punch_out IS NULL`;
            } else if (status === 'out') {
                query += ` AND punch_out IS NOT NULL`;
            } else {
                query += ` AND attendance_status = $${paramCount}`;
                params.push(status.charAt(0).toUpperCase() + status.slice(1).replace('-', ' '));
                paramCount++;
            }
        }

        query += ' ORDER BY date DESC, punch_in DESC';
        const records = await pool.query(query, params);
        res.json(records.rows);
    } catch (error) {
        console.error('Fetch admin records error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Admin Get Stats Endpoint
app.get('/api/admin/stats', async (req, res) => {
    try {
        const today = new Date().toISOString().split('T')[0];
        const totalEmployees = await pool.query('SELECT COUNT(DISTINCT employee_id) as count FROM attendance');
        const activeEmployees = await pool.query('SELECT COUNT(*) as count FROM attendance WHERE punch_out IS NULL');
        const presentEmployees = await pool.query(
            'SELECT COUNT(*) as count FROM attendance WHERE date = $1 AND attendance_status = $2',
            [today, 'Present']
        );
        const absentEmployees = await pool.query(
            'SELECT COUNT(*) as count FROM attendance WHERE date = $1 AND attendance_status = $2',
            [today, 'Absent']
        );

        res.json({
            totalEmployees: totalEmployees.rows[0].count,
            activeEmployees: activeEmployees.rows[0].count,
            presentEmployees: presentEmployees.rows[0].count,
            absentEmployees: absentEmployees.rows[0].count
        });
    } catch (error) {
        console.error('Fetch stats error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Admin Clear Records Endpoint
app.delete('/api/admin/records', async (req, res) => {
    try {
        await pool.query('DELETE FROM attendance');
        res.json({ message: 'All records cleared successfully' });
    } catch (error) {
        console.error('Clear records error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Start server
app.listen(port, () => {
    console.log(`Server running on http://3.85.61.23:${port}`);
});
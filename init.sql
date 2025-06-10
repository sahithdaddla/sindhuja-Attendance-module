
CREATE TABLE attendance (
    id SERIAL PRIMARY KEY,
    employee_id VARCHAR(7) NOT NULL CHECK (employee_id ~ '^ATS0(?!000)\d{3}$'),
    date DATE NOT NULL,
    punch_in TIME NOT NULL,
    punch_out TIME,
    total_hours DECIMAL(5,2),
    attendance_status VARCHAR(20),
    CONSTRAINT valid_status CHECK (attendance_status IN ('Present', 'Half Day', 'Absent'))
);


CREATE INDEX idx_employee_id ON attendance(employee_id);
CREATE INDEX idx_date ON attendance(date);
